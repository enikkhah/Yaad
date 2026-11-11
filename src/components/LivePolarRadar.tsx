import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toPersianDigits } from '../utils/jalali';

export interface PolarTrajectoryPoint {
  distance: number;
  bearingDeg: number;
  timestamp: number;
}

interface LivePolarRadarProps {
  locationTitle: string;
  distanceMeters: number;
  radiusMeters: number;
  targetLat: number;
  targetLon: number;
  userLat?: number;
  userLon?: number;
  mode: 'enter' | 'exit';
  is5Hz?: boolean;
  isVisualOnly?: boolean;
  pingBeat?: number;
  language?: 'fa' | 'en';
}

/**
 * Computes true geographic bearing in degrees [0..360) from Target Center (lat1, lon1)
 * to User Position (lat2, lon2), where 0° = North (up), 90° = East (right).
 */
export function computeGeographicBearingDeg(
  targetLat: number,
  targetLon: number,
  userLat: number,
  userLon: number
): number {
  if (
    !Number.isFinite(targetLat) ||
    !Number.isFinite(targetLon) ||
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLon)
  ) {
    return 315;
  }
  const dLat = Math.abs(userLat - targetLat);
  const dLon = Math.abs(userLon - targetLon);
  if (dLat < 1e-7 && dLon < 1e-7) {
    return 0;
  }
  const phi1 = (targetLat * Math.PI) / 180;
  const phi2 = (userLat * Math.PI) / 180;
  const deltaLambda = ((userLon - targetLon) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

export const LivePolarRadar: React.FC<LivePolarRadarProps> = ({
  locationTitle,
  distanceMeters,
  radiusMeters,
  targetLat,
  targetLon,
  userLat,
  userLon,
  mode,
  is5Hz = false,
  isVisualOnly = false,
  pingBeat = 0,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const safeRadius = Math.max(20, radiusMeters || 200);
  const safeDist = Math.max(0, Math.round(distanceMeters));

  const currentBearingDeg = useMemo(() => {
    if (
      userLat !== undefined &&
      userLon !== undefined &&
      Number.isFinite(userLat) &&
      Number.isFinite(userLon)
    ) {
      return computeGeographicBearingDeg(targetLat, targetLon, userLat, userLon);
    }
    return mode === 'exit' ? 75 : 300;
  }, [targetLat, targetLon, userLat, userLon, mode]);

  const [trail, setTrail] = useState<PolarTrajectoryPoint[]>([]);
  const lastTargetKeyRef = useRef<string>('');

  useEffect(() => {
    const targetKey = `${targetLat.toFixed(5)}_${targetLon.toFixed(5)}_${safeRadius}_${mode}`;
    const now = Date.now();

    if (lastTargetKeyRef.current !== targetKey) {
      lastTargetKeyRef.current = targetKey;
      // Seed an initial origin anchor so the trajectory line is immediately clear
      const anchorDist = mode === 'exit' ? Math.max(4, Math.round(safeRadius * 0.04)) : safeRadius;
      const anchorBearing =
        mode === 'exit'
          ? (currentBearingDeg + 200) % 360
          : (currentBearingDeg + 342) % 360;
      const initialPoints: PolarTrajectoryPoint[] = [];
      if (Math.abs(safeDist - anchorDist) > Math.max(5, safeRadius * 0.06)) {
        const midDist = Math.round((anchorDist + safeDist) / 2);
        const midBearing =
          mode === 'exit'
            ? (currentBearingDeg + 350) % 360
            : (currentBearingDeg + 352) % 360;
        initialPoints.push({
          distance: anchorDist,
          bearingDeg: anchorBearing,
          timestamp: now - 2000,
        });
        initialPoints.push({
          distance: midDist,
          bearingDeg: midBearing,
          timestamp: now - 1000,
        });
      }
      initialPoints.push({
        distance: safeDist,
        bearingDeg: currentBearingDeg,
        timestamp: now,
      });
      setTrail(initialPoints);
      return;
    }

    setTrail((prev) => {
      if (prev.length === 0) {
        return [
          {
            distance: safeDist,
            bearingDeg: currentBearingDeg,
            timestamp: now,
          },
        ];
      }
      const last = prev[prev.length - 1];
      const distDelta = Math.abs(last.distance - safeDist);
      const rawAngDiff = Math.abs(last.bearingDeg - currentBearingDeg) % 360;
      const angDelta = rawAngDiff > 180 ? 360 - rawAngDiff : rawAngDiff;

      const minStepMeters = Math.max(2, safeRadius * 0.018);
      if (distDelta < minStepMeters && angDelta < 4) {
        // Update tip smoothly without crowding trail history
        const updated = prev.slice(0, -1);
        updated.push({
          distance: safeDist,
          bearingDeg: currentBearingDeg,
          timestamp: now,
        });
        return updated;
      }

      const next = [
        ...prev,
        {
          distance: safeDist,
          bearingDeg: currentBearingDeg,
          timestamp: now,
        },
      ];
      return next.slice(-24);
    });
  }, [safeDist, currentBearingDeg, safeRadius, targetLat, targetLon, mode]);

  // SVG Coordinate Geometry (300 x 300 viewBox)
  const size = 300;
  const cx = 150;
  const cy = 158;
  const outerR = 114; // Green geofence boundary circle radius in px
  const centerR = 20; // Central 5% target zone circle radius in px

  const polarToXY = (distMeters: number, bearingDeg: number): { x: number; y: number } => {
    const ratio = Math.max(0, distMeters) / safeRadius;
    let pixelR: number;
    if (ratio <= 0.05) {
      pixelR = (ratio / 0.05) * (centerR * 0.75);
    } else if (ratio <= 1.0) {
      const t = (ratio - 0.05) / 0.95;
      pixelR = centerR + t * (outerR - centerR);
    } else {
      const extra = Math.min(0.1, ratio - 1.0);
      pixelR = outerR + (extra / 0.1) * 12;
    }
    const rad = ((bearingDeg - 90) * Math.PI) / 180;
    return {
      x: cx + pixelR * Math.cos(rad),
      y: cy + pixelR * Math.sin(rad),
    };
  };

  const xyPoints = useMemo(
    () => trail.map((pt) => polarToXY(pt.distance, pt.bearingDeg)),
    [trail, safeRadius]
  );

  const userXY =
    xyPoints.length > 0
      ? xyPoints[xyPoints.length - 1]
      : polarToXY(safeDist, currentBearingDeg);

  // Build smooth SVG path + directional chevrons along the trajectory
  const { pathD, chevrons, modeLabelPos } = useMemo(() => {
    if (xyPoints.length < 2) {
      return {
        pathD: '',
        chevrons: [] as Array<{ x: number; y: number; angleDeg: number }>,
        modeLabelPos: {
          x: userXY.x + (mode === 'exit' ? -22 : -26),
          y: userXY.y - 24,
        },
      };
    }

    let d = `M ${xyPoints[0].x.toFixed(1)} ${xyPoints[0].y.toFixed(1)}`;
    for (let i = 1; i < xyPoints.length; i++) {
      d += ` L ${xyPoints[i].x.toFixed(1)} ${xyPoints[i].y.toFixed(1)}`;
    }

    const arrows: Array<{ x: number; y: number; angleDeg: number }> = [];
    for (let i = 1; i < xyPoints.length; i++) {
      const p0 = xyPoints[i - 1];
      const p1 = xyPoints[i];
      const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (segLen >= 16 || i === Math.floor(xyPoints.length / 2)) {
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const angleDeg = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
        arrows.push({ x: mx, y: my, angleDeg });
      }
    }

    const midIdx = Math.floor(xyPoints.length / 2);
    const midPt = xyPoints[midIdx] || userXY;
    return {
      pathD: d,
      chevrons: arrows.slice(-4),
      modeLabelPos: {
        x: Math.max(46, Math.min(size - 46, midPt.x + (mode === 'exit' ? 18 : -24))),
        y: Math.max(48, Math.min(size - 36, midPt.y - 12)),
      },
    };
  }, [xyPoints, userXY.x, userXY.y, mode]);

  const radiusFormatted = useMemo(() => {
    const valStr = isEn ? String(safeRadius) : toPersianDigits(safeRadius);
    return isEn ? `${valStr} m` : `${valStr} متر`;
  }, [safeRadius, isEn]);

  // Outer green circle with a top-left gap (around 212°..244° in SVG degrees where 0°=3 o'clock, 270°=12 o'clock)
  // so the radius text ("5000 m") sits cleanly along the arc just like the user's sketch
  const boundaryArcPath = useMemo(() => {
    const startAngleRad = (246 * Math.PI) / 180;
    const endAngleRad = ((208 + 360) * Math.PI) / 180;
    const x1 = cx + outerR * Math.cos(startAngleRad);
    const y1 = cy + outerR * Math.sin(startAngleRad);
    const x2 = cx + outerR * Math.cos(endAngleRad);
    const y2 = cy + outerR * Math.sin(endAngleRad);
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${outerR} ${outerR} 0 1 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }, [cx, cy, outerR]);

  const radiusLabelCoords = useMemo(() => {
    const midAngleRad = (227 * Math.PI) / 180;
    return {
      x: cx + outerR * Math.cos(midAngleRad),
      y: cy + outerR * Math.sin(midAngleRad),
      rotateDeg: -43,
    };
  }, [cx, cy, outerR]);

  const trailColor = mode === 'exit' ? '#38BDF8' : '#FBBF24';
  const pulseDurationSec = is5Hz ? 0.2 : 1.35;

  return (
    <div className="relative w-full flex items-center justify-center my-0.5 select-none">
      <div className="relative w-60 h-60 sm:w-64 sm:h-64 rounded-full bg-[#020806] border border-emerald-500/35 shadow-[inset_0_0_32px_rgba(0,0,0,0.95)] flex items-center justify-center overflow-visible">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full h-full overflow-visible"
          aria-label={locationTitle}
        >
          {/* Subtle Polar Range Guide Rings */}
          <circle
            cx={cx}
            cy={cy}
            r={Math.round((outerR + centerR) * 0.5)}
            fill="none"
            stroke="rgba(16, 185, 129, 0.13)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          <line
            x1={cx}
            y1={cy - outerR}
            x2={cx}
            y2={cy + outerR}
            stroke="rgba(16, 185, 129, 0.1)"
            strokeWidth="1"
          />
          <line
            x1={cx - outerR}
            y1={cy}
            x2={cx + outerR}
            y2={cy}
            stroke="rgba(16, 185, 129, 0.1)"
            strokeWidth="1"
          />

          {/* 1. North Indicator ('N' + Red Triangle ▲ at Top Center) */}
          <g transform={`translate(${cx}, 18)`}>
            <text
              x="0"
              y="0"
              textAnchor="middle"
              fill="#EF4444"
              fontSize="14"
              fontWeight="900"
              fontFamily="sans-serif"
            >
              N
            </text>
            <polygon points="0,4 -9,21 9,21" fill="#EF4444" stroke="#B91C1C" strokeWidth="1" />
          </g>

          {/* 2. Outer Green Geofence Boundary Circle with Arc Gap for Radius Label */}
          <path
            d={boundaryArcPath}
            fill="none"
            stroke="#22C55E"
            strokeWidth="2.6"
            strokeLinecap="round"
          />

          {/* Radius Label on Top-Left Arc (e.g. "5000 m") */}
          <g
            transform={`translate(${radiusLabelCoords.x.toFixed(1)}, ${radiusLabelCoords.y.toFixed(
              1
            )}) rotate(${radiusLabelCoords.rotateDeg})`}
          >
            <text
              x="0"
              y="4"
              textAnchor="middle"
              fill="#4ADE80"
              fontSize="13"
              fontWeight="900"
              fontFamily="monospace, sans-serif"
            >
              {radiusFormatted}
            </text>
          </g>

          {/* 3. Central 5% Target Zone (Filled Teal/Cyan Circle with Bright Green Border + Target Name) */}
          <circle
            cx={cx}
            cy={cy}
            r={centerR}
            fill="rgba(20, 184, 166, 0.82)"
            stroke="#22C55E"
            strokeWidth="2.8"
          />
          <text
            x={cx}
            y={cy - centerR - 7}
            textAnchor="middle"
            fill="#C084FC"
            fontSize="11.5"
            fontWeight="800"
          >
            {locationTitle.length > 18 ? `${locationTitle.slice(0, 18)}…` : locationTitle}
          </text>

          {/* 4. Live Dotted Trajectory Path + Directional Chevrons */}
          {pathD && (
            <>
              <path
                d={pathD}
                fill="none"
                stroke={trailColor}
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="1 8"
              />
              {chevrons.map((ch, idx) => (
                <g
                  key={`chev-${idx}`}
                  transform={`translate(${ch.x.toFixed(1)}, ${ch.y.toFixed(
                    1
                  )}) rotate(${ch.angleDeg.toFixed(1)})`}
                >
                  <polyline
                    points="-5,-4.5 4,0 -5,4.5"
                    fill="none"
                    stroke={trailColor}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ))}
              <text
                x={modeLabelPos.x}
                y={modeLabelPos.y}
                textAnchor="middle"
                fill={trailColor}
                fontSize="12"
                fontWeight="900"
                fontFamily="sans-serif"
              >
                {mode === 'exit' ? 'exit' : 'enter'}
              </text>
            </>
          )}

          {/* 5. Moving Pulsing Character Icon at User's Live Polar Position (userXY) */}
          <g transform={`translate(${userXY.x.toFixed(1)}, ${userXY.y.toFixed(1)})`}>
            {!isVisualOnly && (
              <>
                {/* Outer Pulsing Sonar Wave Ring */}
                <circle
                  key={`radar-wave-1-${is5Hz ? '5hz' : pingBeat}`}
                  cx="0"
                  cy="-8"
                  r="14"
                  fill="none"
                  stroke="#FACC15"
                  strokeWidth="1.6"
                  opacity="0.75"
                >
                  <animate
                    attributeName="r"
                    from="11"
                    to="28"
                    dur={`${pulseDurationSec}s`}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    from="0.85"
                    to="0"
                    dur={`${pulseDurationSec}s`}
                    repeatCount="indefinite"
                  />
                </circle>

                {/* Inner Pulsing Sonar Wave Ring + Dashed Rays */}
                <circle
                  cx="0"
                  cy="-8"
                  r="19"
                  fill="none"
                  stroke="#FDE047"
                  strokeWidth="1.2"
                  strokeDasharray="3 4"
                  opacity="0.65"
                >
                  <animate
                    attributeName="r"
                    from="13"
                    to="23"
                    dur={`${pulseDurationSec}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              </>
            )}

            {/* Golden Location Pin with Clock Inside (matching the user's sketch character) */}
            <g>
              {!isVisualOnly && (
                <animateTransform
                  attributeName="transform"
                  type="scale"
                  values="1;1.15;1"
                  dur={`${pulseDurationSec}s`}
                  repeatCount="indefinite"
                />
              )}
              {/* Pin Drop Shape pointing to (0, 6) */}
              <path
                d="M 0 6 C -4 0 -10 -4 -10 -10 A 10 10 0 1 1 10 -10 C 10 -4 4 0 0 6 Z"
                fill="#090D0B"
                stroke="#FACC15"
                strokeWidth="2.4"
                strokeLinejoin="round"
              />
              {/* Clock Face Circle inside Pin Head */}
              <circle
                cx="0"
                cy="-10"
                r="6.2"
                fill="#090D0B"
                stroke="#FACC15"
                strokeWidth="1.7"
              />
              {/* Clock Hands (12 to center, center to 4 o'clock) */}
              <polyline
                points="0,-14 0,-10 3.2,-8.2"
                fill="none"
                stroke="#FACC15"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
};
