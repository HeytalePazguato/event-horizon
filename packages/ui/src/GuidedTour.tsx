/**
 * 4-step guided tour overlay for first-time users.
 * Highlights Command Center panels one at a time with a tooltip.
 * Persisted via tourCompleted in the store — never shows again after completion.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useCommandCenterStore } from './store.js';

interface TourStep {
  /** CSS selector for the element to highlight. */
  selector: string;
  title: string;
  desc: string;
  /** Position of the tooltip relative to the highlighted element. */
  position: 'above' | 'above-left' | 'above-right';
}

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="identity"]',
    title: '1/4 — Agent Identity',
    desc: 'Click a planet to see its name, type, state, and working directory here.',
    position: 'above',
  },
  {
    selector: '[data-tour="metrics"]',
    title: '2/4 — Metrics & Logs',
    desc: 'Switch tabs for live metrics, event logs, achievement medals, and installed skills.',
    position: 'above',
  },
  {
    selector: '[data-tour="commands"]',
    title: '3/4 — Command Grid',
    desc: 'Pause, isolate, connect agents, export stats, and more. Hover any button for details.',
    position: 'above-left',
  },
  {
    selector: '[data-tour="universe"]',
    title: '4/4 — The Universe',
    desc: 'Click planets to select agents. Click the black hole for global stats. Drag to rearrange.',
    position: 'above',
  },
];

const BACKDROP_Z = 9990;
const TOOLTIP_Z = 9991;

const GuidedTourOverlay: FC<{ step: number; onNext: () => void; onSkip: () => void }> = ({ step, onNext, onSkip }) => {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const current = STEPS[step];

  useEffect(() => {
    const el = document.querySelector(current.selector);
    if (el) {
      setRect(el.getBoundingClientRect());
    }
    // Recalc on resize
    const onResize = () => {
      const el2 = document.querySelector(current.selector);
      if (el2) setRect(el2.getBoundingClientRect());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [step, current.selector]);

  if (!rect) return null;

  const pad = 6;
  const cutout = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  // Tooltip positioning
  let tooltipStyle: React.CSSProperties;
  const tooltipW = 260;
  if (current.position === 'above-left') {
    tooltipStyle = {
      position: 'fixed',
      bottom: window.innerHeight - cutout.top + 12,
      right: window.innerWidth - (cutout.left + cutout.width),
      width: tooltipW,
    };
  } else if (current.position === 'above-right') {
    tooltipStyle = {
      position: 'fixed',
      bottom: window.innerHeight - cutout.top + 12,
      left: cutout.left,
      width: tooltipW,
    };
  } else {
    // 'above' — centered
    tooltipStyle = {
      position: 'fixed',
      bottom: window.innerHeight - cutout.top + 12,
      left: cutout.left + cutout.width / 2 - tooltipW / 2,
      width: tooltipW,
    };
  }

  // Clamp horizontally so tooltip doesn't go off-screen
  if (tooltipStyle.left != null) {
    const l = tooltipStyle.left as number;
    if (l < 8) tooltipStyle.left = 8;
    if (l + tooltipW > window.innerWidth - 8) tooltipStyle.left = window.innerWidth - tooltipW - 8;
  }

  const isLast = step === STEPS.length - 1;

  return createPortal(
    <>
      {/* Semi-transparent backdrop with cutout */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: BACKDROP_Z,
          pointerEvents: 'auto',
        }}
        onClick={onNext}
      >
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          <defs>
            <mask id="eh-tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={cutout.left}
                y={cutout.top}
                width={cutout.width}
                height={cutout.height}
                rx={4}
                fill="black"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#eh-tour-mask)" />
          {/* Highlight border around cutout */}
          <rect
            x={cutout.left}
            y={cutout.top}
            width={cutout.width}
            height={cutout.height}
            rx={4}
            fill="none"
            stroke="#30a050"
            strokeWidth={2}
            opacity={0.7}
          />
        </svg>
      </div>

      {/* Tooltip */}
      <div
        style={{
          ...tooltipStyle,
          zIndex: TOOLTIP_Z,
          background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
          border: '1px solid #2a5a3c',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.8), 0 0 12px rgba(40,160,80,0.12)',
          padding: '10px 12px',
          fontFamily: 'Consolas, monospace',
          pointerEvents: 'auto',
          clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#90d898', letterSpacing: '0.04em', marginBottom: 5 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 10, color: '#6a9a78', lineHeight: 1.5, marginBottom: 10 }}>
          {current.desc}
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: i === step ? '#40c060' : '#1a3828',
                border: `1px solid ${i === step ? '#40c060' : '#2a4a38'}`,
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSkip(); }}
            style={{
              background: 'none',
              border: 'none',
              color: '#3a6a48',
              fontSize: 9,
              fontFamily: 'Consolas, monospace',
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            Skip tour
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            style={{
              background: 'linear-gradient(180deg, #1a3828 0%, #0f2018 100%)',
              border: '1px solid #25904a',
              borderRadius: 3,
              color: '#60d080',
              fontSize: 10,
              fontFamily: 'Consolas, monospace',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 14px',
              letterSpacing: 0.3,
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
};

export const GuidedTour: FC = () => {
  const tourCompleted = useCommandCenterStore((s) => s.tourCompleted);
  const setTourCompleted = useCommandCenterStore((s) => s.setTourCompleted);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const ccMinimized = useCommandCenterStore((s) => s.ccMinimized);
  const tourRequestedAt = useCommandCenterStore((s) => s.tourRequestedAt);

  const [tourStep, setTourStep] = useState<number | null>(null);

  // Auto-start tour the first time a planet is selected (user has an agent and interacted)
  useEffect(() => {
    if (!tourCompleted && selectedAgentId && tourStep === null && !ccMinimized) {
      const timer = setTimeout(() => setTourStep(0), 600);
      return () => clearTimeout(timer);
    }
  }, [tourCompleted, selectedAgentId, tourStep, ccMinimized]);

  // Manual restart via "?" button — works regardless of planet selection
  useEffect(() => {
    if (tourRequestedAt > 0 && !ccMinimized) {
      setTourStep(0);
    }
  }, [tourRequestedAt, ccMinimized]);

  const handleNext = useCallback(() => {
    setTourStep((prev) => {
      if (prev === null) return null;
      if (prev >= STEPS.length - 1) {
        setTourCompleted(true);
        return null;
      }
      return prev + 1;
    });
  }, [setTourCompleted]);

  const handleSkip = useCallback(() => {
    setTourCompleted(true);
    setTourStep(null);
  }, [setTourCompleted]);

  if (tourStep === null) return null;

  return <GuidedTourOverlay step={tourStep} onNext={handleNext} onSkip={handleSkip} />;
};

/** Restart the tour (called from the header "?" button). */
export function restartTour(): void {
  useCommandCenterStore.getState().requestTour();
}
