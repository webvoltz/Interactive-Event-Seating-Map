import { memo, useMemo, useEffect } from "react";
import { useVenueStore } from "../store/seatStore";
import type { Section } from "../interfaces/venue.interfaces";
import Seats from "./Seat";

function Section({ section }: { section: Section }) {
    const activeSectionId = useVenueStore(
        (s) => s.activeSectionId
    );
    const setZoom = useVenueStore((s) => s.setZoom);
    const setActiveSection = useVenueStore((s) => s.setActiveSection);

    const isActive = activeSectionId === section.id;

    useEffect(() => {
        if (isActive) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            section.rows.forEach(row => {
                row.seats.forEach(seat => {
                    minX = Math.min(minX, seat.x);
                    minY = Math.min(minY, seat.y);
                    maxX = Math.max(maxX, seat.x);
                    maxY = Math.max(maxY, seat.y);
                });
            });

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            const timer = setTimeout(() => {
                const mapContainer = document.querySelector('main.overflow-auto');
                if (mapContainer) {
                    const currentZoom = useVenueStore.getState().zoom;
                    const scrollX = (centerX * currentZoom) - (mapContainer.clientWidth / 2);
                    const scrollY = (centerY * currentZoom) - (mapContainer.clientHeight / 2);

                    mapContainer.scrollTo({
                        left: Math.max(0, scrollX),
                        top: Math.max(0, scrollY),
                        behavior: 'smooth'
                    });
                }
            }, 150);
            return () => clearTimeout(timer);
        }
    }, [isActive, section]);

    const coverPath = useMemo(() => {
        if (!section.rows.length) return "";

        const firstRow = section.rows[0];
        const lastRow = section.rows[section.rows.length - 1];

        let d = `M ${firstRow.seats[0].x} ${firstRow.seats[0].y}`;

        for (let i = 1; i < firstRow.seats.length; i++) {
            d += ` L ${firstRow.seats[i].x} ${firstRow.seats[i].y}`;
        }

        for (let i = lastRow.seats.length - 1; i >= 0; i--) {
            d += ` L ${lastRow.seats[i].x} ${lastRow.seats[i].y}`;
        }

        d += " Z";
        return d;
    }, [section]);

    const { labelPos, explodeOffset } = useMemo(() => {
        if (!section.rows.length) return { labelPos: { x: 0, y: 0 }, explodeOffset: { x: 0, y: 0 } };

        const firstRowMid = section.rows[0].seats[Math.floor(section.rows[0].seats.length / 2)];
        const lastRowMid = section.rows[section.rows.length - 1].seats[Math.floor(section.rows[section.rows.length - 1].seats.length / 2)];

        const centerX = (firstRowMid.x + lastRowMid.x) / 2;
        const centerY = (firstRowMid.y + lastRowMid.y) / 2;
        const labelPosition = { x: centerX, y: centerY };

        const venueCenterX = 1200;
        const venueCenterY = 1200;
        const dx = centerX - venueCenterX;
        const dy = centerY - venueCenterY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const gap = 40;
        let offX = 0;
        let offY = 0;

        if (dist > 0) {
            offX = (dx / dist) * gap;
            offY = (dy / dist) * gap;
        }

        return {
            labelPos: labelPosition,
            explodeOffset: { x: offX, y: offY }
        };
    }, [section]);

    return (
        <g
            onClick={(e) => {
                e.stopPropagation();
                const newActiveId = isActive ? null : section.id;
                setActiveSection(newActiveId);
                if (newActiveId) setZoom(1.5);
            }}
            style={{ cursor: "pointer" }}
            transform={`translate(${explodeOffset.x} ${explodeOffset.y})`}
        >
            {isActive ? (
                <>
                    <path
                        d={coverPath}
                        fill="white"
                        fillOpacity="0.01"
                        stroke="none"
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: "default" }}
                    />
                    <Seats rows={section.rows} />
                </>
            ) : (
                <g className="hover:opacity-80 transition-opacity">
                    <path
                        d={coverPath}
                        fill="#e2e8f0"
                        strokeWidth={25}
                        strokeLinejoin="round"
                        className="drop-shadow-sm"
                    />
                    <path
                        d={coverPath}
                        fill="none"
                        stroke="#94a3b8"
                        strokeLinejoin="round"
                    />

                    <text
                        x={labelPos.x}
                        y={labelPos.y - 5}
                        textAnchor="middle"
                        className="text-sm font-bold fill-slate-700"
                        style={{ pointerEvents: 'none' }}
                    >
                        {section.label}
                    </text>

                </g>
            )}
        </g>
    );
}

export default memo(Section);
