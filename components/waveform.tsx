export function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-14 items-center justify-center gap-1" aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <span
          key={index}
          className={`w-1 rounded-full bg-teal ${active ? "wave-bar" : "h-2 opacity-35"}`}
          style={
            active
              ? {
                  height: `${12 + ((index * 17) % 32)}px`,
                  animationDelay: `${index * 45}ms`,
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
