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
    return 315;
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

  // SVG Coordinate Geometry:
  // Horizontal width = 312, outerR = 148 (leaves only 8px on left & right inside SVG;
  // combined with 12px modal/card horizontal padding = 20px from both screen edges).
  const svgW = 312;
  const svgH = 330;
  const cx = 156;
  const cy = 174;
  const outerR = 148; // Green geofence boundary circle radius
  const centerR = 22; // Central 5% target zone circle radius

  const polarToXY = (distMeters: number, bearingDeg: number): { x: number; y: number } => {
    const ratio = Math.max(0, distMeters) / safeRadius;
    let pixelR: number;
    if (ratio <= 0.05) {
      pixelR = (ratio / 0.05) * (centerR * 0.45);
    } else if (ratio <= 1.0) {
      const t = (ratio - 0.05) / 0.95;
      pixelR = centerR + t * (outerR - centerR);
    } else {
      const extra = Math.min(0.08, ratio - 1.0);
      pixelR = outerR + (extra / 0.08) * 6;
    }
    const rad = ((bearingDeg - 90) * Math.PI) / 180;
    return {
      x: cx + pixelR * Math.cos(rad),
      y: cy + pixelR * Math.sin(rad),
    };
  };

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
      const anchorDist = mode === 'exit' ? Math.max(2, Math.round(safeRadius * 0.03)) : safeRadius;
      const anchorBearing =
        mode === 'exit'
          ? (currentBearingDeg + 195) % 360
          : (currentBearingDeg + 332) % 360;
      const initialPoints: PolarTrajectoryPoint[] = [];
      if (Math.abs(safeDist - anchorDist) > Math.max(5, safeRadius * 0.06)) {
        const q1Dist = Math.round(anchorDist + (safeDist - anchorDist) * 0.33);
        const q2Dist = Math.round(anchorDist + (safeDist - anchorDist) * 0.67);
        const q1Bearing =
          mode === 'exit'
            ? (currentBearingDeg + 340) % 360
            : (currentBearingDeg + 342) % 360;
        const q2Bearing =
          mode === 'exit'
            ? (currentBearingDeg + 352) % 360
            : (currentBearingDeg + 352) % 360;
        initialPoints.push({
          distance: anchorDist,
          bearingDeg: anchorBearing,
          timestamp: now - 3000,
        });
        initialPoints.push({
          distance: q1Dist,
          bearingDeg: q1Bearing,
          timestamp: now - 2000,
        });
        initialPoints.push({
          distance: q2Dist,
          bearingDeg: q2Bearing,
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
      const lastXY = polarToXY(last.distance, last.bearingDeg);
      const nextXY = polarToXY(safeDist, currentBearingDeg);
      const pixelStep = Math.hypot(nextXY.x - lastXY.x, nextXY.y - lastXY.y);

      // Only add a new vertex if the marker moved at least 11px on the radar;
      // otherwise update the current tip in-place so GPS noise never overwrites the trail
      if (pixelStep < 11) {
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

  const xyPoints = useMemo(
    () => trail.map((pt) => polarToXY(pt.distance, pt.bearingDeg)),
    [trail, safeRadius]
  );

  const userXY =
    xyPoints.length > 0
      ? xyPoints[xyPoints.length - 1]
      : polarToXY(safeDist, currentBearingDeg);

  // Build smooth SVG path + directional chevrons + arc-length midpoint for 'enter'/'exit' label
  const { pathD, chevrons, modeLabelPos } = useMemo(() => {
    if (xyPoints.length < 2) {
      return {
        pathD: '',
        chevrons: [] as Array<{ x: number; y: number; angleDeg: number }>,
        modeLabelPos: {
          x: cx - 44,
          y: cy - 36,
        },
      };
    }

    let d = `M ${xyPoints[0].x.toFixed(1)} ${xyPoints[0].y.toFixed(1)}`;
    let totalLen = 0;
    const segLengths: number[] = [];
    for (let i = 1; i < xyPoints.length; i++) {
      d += ` L ${xyPoints[i].x.toFixed(1)} ${xyPoints[i].y.toFixed(1)}`;
      const len = Math.hypot(
        xyPoints[i].x - xyPoints[i - 1].x,
        xyPoints[i].y - xyPoints[i - 1].y
      );
      segLengths.push(len);
      totalLen += len;
    }

    const arrows: Array<{ x: number; y: number; angleDeg: number }> = [];
    for (let i = 1; i < xyPoints.length; i++) {
      const p0 = xyPoints[i - 1];
      const p1 = xyPoints[i];
      const segLen = segLengths[i - 1];
      if (segLen >= 20) {
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const angleDeg = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
        arrows.push({ x: mx, y: my, angleDeg });
      }
    }

    // Find true geometric midpoint at 50% of total path length
    let halfTarget = totalLen * 0.5;
    let midPt = xyPoints[Math.floor(xyPoints.length / 2)];
    for (let i = 0; i < segLengths.length; i++) {
      if (halfTarget <= segLengths[i] && segLengths[i] > 0) {
        const ratio = halfTarget / segLengths[i];
        midPt = {
          x: xyPoints[i].x + (xyPoints[i + 1].x - xyPoints[i].x) * ratio,
          y: xyPoints[i].y + (xyPoints[i + 1].y - xyPoints[i].y) * ratio,
        };
        break;
      }
      halfTarget -= segLengths[i];
    }

    // Ensure the mode label stays in the middle annulus and never overlaps the center circle
    let lx = midPt.x + (mode === 'exit' ? 22 : -26);
    let ly = midPt.y - 10;
    const distFromCenter = Math.hypot(lx - cx, ly - cy);
    if (distFromCenter < centerR + 26) {
      lx = cx + (mode === 'exit' ? 52 : -52);
      ly = cy - 28;
    }

    return {
      pathD: d,
      chevrons: arrows.slice(-4),
      modeLabelPos: {
        x: Math.max(42, Math.min(svgW - 42, lx)),
        y: Math.max(52, Math.min(svgH - 36, ly)),
      },
    };
  }, [xyPoints, mode]);

  const radiusFormatted = useMemo(() => {
    const valStr = isEn ? String(safeRadius) : toPersianDigits(safeRadius);
    return isEn ? `${valStr} m` : `${valStr} متر`;
  }, [safeRadius, isEn]);

  // Outer green circle with a top-left gap (210°..242°) for the radius label
  const boundaryArcPath = useMemo(() => {
    const startAngleRad = (244 * Math.PI) / 180;
    const endAngleRad = ((208 + 360) * Math.PI) / 180;
    const x1 = cx + outerR * Math.cos(startAngleRad);
    const y1 = cy + outerR * Math.sin(startAngleRad);
    const x2 = cx + outerR * Math.cos(endAngleRad);
    const y2 = cy + outerR * Math.sin(endAngleRad);
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${outerR} ${outerR} 0 1 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }, [cx, cy, outerR]);

  const radiusLabelCoords = useMemo(() => {
    const midAngleRad = (226 * Math.PI) / 180;
    return {
      x: cx + outerR * Math.cos(midAngleRad),
      y: cy + outerR * Math.sin(midAngleRad),
      rotateDeg: -44,
    };
  }, [cx, cy, outerR]);

  const trailColor = mode === 'exit' ? '#38BDF8' : '#FBBF24';
  const pulseDurationSec = is5Hz ? 0.22 : 1.35;

  return (
    <div className="relative w-full flex items-center justify-center select-none">
      <div className="relative w-full max-w-[420px] flex items-center justify-center overflow-visible">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto overflow-visible"
          aria-label={locationTitle}
        >
          {/* Dark Radar Interior Fill directly inside the Green Boundary Circle */}
          <circle
            cx={cx}
            cy={cy}
            r={outerR}
            fill="#020806"
          />

          {/* Subtle Polar Range Guide Rings & Crosshairs */}
          <circle
            cx={cx}
            cy={cy}
            r={Math.round((outerR + centerR) * 0.52)}
            fill="none"
            stroke="rgba(16, 185, 129, 0.14)"
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

          {/* 1. North Indicator ('N' + Red Triangle ▲ directly above the green boundary circle) */}
          <g transform={`translate(${cx}, ${cy - outerR - 20})`}>
            <text
              x="0"
              y="0"
              textAnchor="middle"
              fill="#EF4444"
              fontSize="13"
              fontWeight="900"
              fontFamily="sans-serif"
            >
              N
            </text>
            <polygon points="0,3 -8,17 8,17" fill="#EF4444" stroke="#B91C1C" strokeWidth="0.9" />
          </g>

          {/* 2. Outer Green Geofence Boundary Circle with Arc Gap for Radius Label */}
          <path
            d={boundaryArcPath}
            fill="none"
            stroke="#22C55E"
            strokeWidth="2.8"
            strokeLinecap="round"
          />

          {/* Radius Label on Top-Left Arc (e.g. "5000 متر") */}
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
              fontSize="12.5"
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
            {locationTitle.length > 20 ? `${locationTitle.slice(0, 20)}…` : locationTitle}
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

          {/* 5. Official YAAD App Logo (Brand Orange Location-Clock Pin) at User's Live Polar Position */}
          <g transform={`translate(${userXY.x.toFixed(1)}, ${userXY.y.toFixed(1)})`}>
            {!isVisualOnly && (
              <>
                {/* Outer Pulsing Sonar Wave Ring */}
                <circle
                  key={`radar-wave-1-${is5Hz ? '5hz' : pingBeat}`}
                  cx="0"
                  cy="0"
                  r="14"
                  fill="none"
                  stroke="#FF8C00"
                  strokeWidth="1.8"
                  opacity="0.8"
                >
                  <animate
                    attributeName="r"
                    from="12"
                    to="30"
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

                {/* Inner Pulsing Dashed Sonar Ring */}
                <circle
                  cx="0"
                  cy="0"
                  r="18"
                  fill="none"
                  stroke="#FDBA74"
                  strokeWidth="1.3"
                  strokeDasharray="3 4"
                  opacity="0.7"
                >
                  <animate
                    attributeName="r"
                    from="14"
                    to="24"
                    dur={`${pulseDurationSec}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              </>
            )}

            {/* Official YAAD Location-Clock Vector Logo (1024x1024 scaled to 32x32 centered at 0,0) */}
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
              <g transform="translate(-16, -16) scale(0.03125)">
                {/* Dark interior backdrop so clock hands remain ultra-crisp over any line/circle */}
                <path
                  fill="#041512"
                  d="M 512 95 C 675 95, 812 225, 812 393.2 C 812 555, 662 752, 512 910 C 362 752, 212 555, 212 393.2 C 212 225, 349 95, 512 95 Z"
                />
                {/* Outer Teardrop Location Pin (Official YAAD #FF8C00) */}
                <path
                  fill="#FF8C00"
                  fillRule="evenodd"
                  d="M 512 51.2
                     C 700.9 51.2, 854 204.3, 854 393.2
                     C 854 576.0, 692.0 788.0, 545.5 956.5
                     C 527.8 976.8, 496.2 976.8, 478.5 956.5
                     C 332.0 788.0, 170 576.0, 170 393.2
                     C 170 204.3, 323.1 51.2, 512 51.2 Z
                     M 512 135.2
                     C 369.5 135.2, 254 250.7, 254 393.2
                     C 254 538.0, 388.0 722.0, 512 863.0
                     C 636.0 722.0, 770 538.0, 770 393.2
                     C 770 250.7, 654.5 135.2, 512 135.2 Z"
                />
                {/* Integrated Clock Hands (Official YAAD #FF8C00) */}
                <path
                  d="M 512 237 L 512 393.2 L 625 458.5"
                  fill="none"
                  stroke="#FF8C00"
                  strokeWidth="72"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
};
