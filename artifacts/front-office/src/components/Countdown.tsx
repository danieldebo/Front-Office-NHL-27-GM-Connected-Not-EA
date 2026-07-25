import { useEffect, useState } from 'react';

export default function Countdown({ closesAt }: { closesAt?: string }) {
  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(closesAt));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(closesAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [closesAt]);

  function calculateTimeLeft(targetDate?: string) {
    if (!targetDate) return { d: ['0', '0'], h: ['0', '0'], m: ['0', '0'] };
    const diff = Math.max(0, new Date(targetDate).getTime() - Date.now());
    const s = Math.floor(diff / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      d: pad(Math.floor(s / 86400)).split(''),
      h: pad(Math.floor((s % 86400) / 3600)).split(''),
      m: pad(Math.floor((s % 3600) / 60)).split('')
    };
  }

  return (
    <div className="clock" role="timer" aria-live="off" aria-label="Time remaining">
      <div className="digit-group">
        <div className="digits">
          <span className="digit">{timeLeft.d[0]}</span>
          <span className="digit">{timeLeft.d[1]}</span>
        </div>
        <span className="digit-label">Days</span>
      </div>
      <span className="colon">:</span>
      <div className="digit-group">
        <div className="digits">
          <span className="digit">{timeLeft.h[0]}</span>
          <span className="digit">{timeLeft.h[1]}</span>
        </div>
        <span className="digit-label">Hrs</span>
      </div>
      <span className="colon">:</span>
      <div className="digit-group">
        <div className="digits">
          <span className="digit">{timeLeft.m[0]}</span>
          <span className="digit">{timeLeft.m[1]}</span>
        </div>
        <span className="digit-label">Min</span>
      </div>
    </div>
  );
}
