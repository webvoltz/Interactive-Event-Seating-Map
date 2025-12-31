import { memo } from "react";
import type { Row } from "../interfaces/venue.interfaces";

function SectionSkeleton({ rows }: { rows: Row[] }) {
    return (
        <>
            {rows.map((row, rowIndex) =>
                row.seats
                    .filter((_, i) => i % 6 === 0)
                    .map((seat, seatIndex) => (
                        <rect
                            key={`${rowIndex}-${seatIndex}`}
                            x={seat.x - 1.5}
                            y={seat.y - 1.5}
                            width={3}
                            height={3}
                            rx={1}
                            fill="#94a3b8"
                            opacity={0.8}
                        />
                    ))
            )}
        </>
    );
}

export default memo(SectionSkeleton);
