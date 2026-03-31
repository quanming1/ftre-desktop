export function PixelLogo({ size = 2 }: { size?: number }) {
  const letters: Record<string, number[][]> = {
    F: [
      [1, 1, 1, 1],
      [1, 0, 0, 0],
      [1, 1, 1, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
    ],
    t: [
      [1, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    r: [
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 1],
      [1, 0, 1],
      [1, 0, 1],
    ],
    e: [
      [1, 1, 1],
      [1, 0, 0],
      [1, 1, 1],
      [1, 0, 0],
      [1, 1, 1],
    ],
  };

  return (
    <div className="flex items-end gap-[1px]">
      {["F", "t", "r", "e"].map((char, ci) => (
        <div key={ci} className="flex flex-col">
          {letters[char].map((row, ri) => (
            <div key={ri} className="flex">
              {row.map((cell, j) => (
                <div
                  key={j}
                  style={{
                    width: size,
                    height: size,
                    backgroundColor: cell ? "#00ff88" : "transparent",
                    opacity: cell ? (ci === 0 ? 1 : 0.6 + ci * 0.1) : 0,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
