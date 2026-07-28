import React, { useState } from 'react';

interface StoryGlowCardProps {
  href: string;
  year: string;
  icon: string;
  title: string;
  description: string;
}

export default function StoryGlowCard({ href, year, icon, title, description }: StoryGlowCardProps) {
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <a
      href={href}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative flex flex-col gap-3 p-5 rounded-md border border-brand-hairline bg-brand-canvas transition-all duration-300 shadow-lvl1 hover:shadow-lvl3 cursor-pointer overflow-hidden"
    >
      {/* Ambient mouse-glow background */}
      {isHovered && (
        <div
          className="absolute pointer-events-none transition-opacity duration-300"
          style={{
            width: '350px',
            height: '350px',
            background: 'radial-gradient(circle, rgba(0, 112, 243, 0.15) 0%, transparent 70%)',
            left: `${coords.x - 175}px`,
            top: `${coords.y - 175}px`,
            transform: 'translate3d(0, 0, 0)',
          }}
        />
      )}

      {/* Glowing border highlight following mouse */}
      {isHovered && (
        <div
          className="absolute inset-0 pointer-events-none rounded-md border border-brand-accent/50 transition-opacity duration-300"
          style={{
            maskImage: `radial-gradient(150px circle at ${coords.x}px ${coords.y}px, black, transparent)`,
            WebkitMaskImage: `radial-gradient(150px circle at ${coords.x}px ${coords.y}px, black, transparent)`,
          }}
        />
      )}

      {/* Card Content */}
      <div className="relative z-10 flex items-center justify-between">
        <span className="text-2xl select-none">{icon}</span>
        <span className="text-[10px] font-mono text-brand-mute border border-brand-hairline rounded-full px-2 py-0.5 select-none">
          {year}
        </span>
      </div>
      <h3 className="relative z-10 text-base font-semibold tracking-tight text-brand-ink group-hover:text-brand-accent transition-colors select-none">
        {title}
      </h3>
      <p className="relative z-10 text-xs text-brand-body leading-relaxed line-clamp-2 flex-grow select-none">
        {description}
      </p>
      <span className="relative z-10 text-xs font-semibold text-brand-accent mt-2 group-hover:translate-x-0.5 transition-transform flex items-center gap-1 select-none">
        Play Story &rarr;
      </span>
    </a>
  );
}
