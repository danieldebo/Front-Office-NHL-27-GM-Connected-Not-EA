import React from "react";

const ink = "#111416";
const paper = "#f4f2ed";
const red = "#cf2e35";
const soft = "#c9c9c3";
const graphite = "#2a2e2f";

function HockeyStickF() {
  return (
    <g aria-label="F built from hockey sticks">
      <path d="M83 48h20v150c0 12 5 18 16 18h20c12 0 20-5 26-17l11-24 17 8-11 26c-8 19-22 29-43 29h-22c-22 0-34-13-34-36V48z" fill={ink} />
      <path d="M83 48h20v17H83z" fill={red} />
      <path d="M83 52h20M83 59h20" stroke={paper} strokeWidth="3" opacity=".8" />
      <path d="M103 67h4v127h-4z" fill={paper} opacity=".18" />
      <path d="M127 214h12c12 0 20-5 26-17l11-24 8 4-11 26c-8 17-19 25-37 25h-9z" fill={red} opacity=".9" />
      <path d="M153 209c7-7 10-15 14-25" fill="none" stroke={paper} strokeWidth="2" opacity=".5" />
      <path d="M102 76h115v18H102z" fill={ink} />
      <path d="M102 133h88v18h-88z" fill={ink} />
      <path d="M102 76h26v18h-26zM102 133h24v18h-24z" fill={red} />
      <path d="M171 76h46l-7 18h-39zM154 133h36l-7 18h-29z" fill={graphite} />
      <path d="M201 77l-7 16M208 77l-7 16M174 134l-7 16" stroke={soft} strokeWidth="2" opacity=".7" />
    </g>
  );
}

function PuckO() {
  return (
    <g aria-label="O built from a hockey puck">
      <ellipse cx="316" cy="231" rx="78" ry="16" fill={ink} opacity=".2" />
      <path d="M229 137v25c0 43 38 78 87 78s87-35 87-78v-25z" fill={graphite} />
      <path d="M229 150v12c0 43 38 78 87 78s87-35 87-78v-12c-3 41-41 70-87 70s-84-29-87-70z" fill={ink} opacity=".75" />
      <ellipse cx="316" cy="137" rx="87" ry="77" fill={ink} />
      <ellipse cx="316" cy="137" rx="76" ry="66" fill="#34393a" stroke={soft} strokeWidth="3" />
      <ellipse cx="316" cy="137" rx="67" ry="57" fill={ink} stroke="#4c5251" strokeWidth="4" />
      <ellipse cx="316" cy="137" rx="57" ry="47" fill="none" stroke={soft} strokeWidth="2" opacity=".55" />
      <ellipse cx="316" cy="137" rx="31" ry="25" fill={paper} />
      <ellipse cx="316" cy="137" rx="22" ry="17" fill="#dedbd4" stroke={ink} strokeWidth="7" />
      <path d="M249 111c17-28 45-41 71-41 28 0 52 12 68 33" fill="none" stroke={red} strokeWidth="8" strokeLinecap="round" />
      <path d="M258 171c16 20 35 30 58 30 25 0 49-12 64-32" fill="none" stroke={red} strokeWidth="5" strokeLinecap="round" opacity=".9" />
      <path d="M285 84c10-5 20-7 31-7" fill="none" stroke={paper} strokeWidth="4" strokeLinecap="round" opacity=".9" />
      <g fill={soft} opacity=".35">
        <circle cx="274" cy="119" r="2" /><circle cx="292" cy="105" r="2" /><circle cx="342" cy="101" r="2" />
        <circle cx="359" cy="116" r="2" /><circle cx="264" cy="143" r="2" /><circle cx="365" cy="146" r="2" />
        <circle cx="286" cy="169" r="2" /><circle cx="346" cy="173" r="2" />
      </g>
    </g>
  );
}

function Mark({ compact = false }: { compact?: boolean }) {
  const patternId = compact ? "micro-rink" : "rink-lines";
  return (
    <svg viewBox={compact ? "0 0 220 220" : "0 0 430 280"} className={compact ? "compact-mark" : "wide-mark"} role="img" aria-label="Front Office FO precision mark">
      <defs>
        <pattern id={patternId} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M0 31.5h32M31.5 0v32" stroke={soft} strokeWidth="1" opacity=".28" />
        </pattern>
      </defs>
      {!compact && (
        <>
          <rect x="17" y="17" width="396" height="246" rx="18" fill={paper} />
          <rect x="17" y="17" width="396" height="246" rx="18" fill={`url(#${patternId})`} />
          <path d="M39 140h350" stroke={red} strokeWidth="2" opacity=".65" />
          <path d="M218 30v220" stroke={soft} strokeWidth="2" opacity=".7" />
          <circle cx="218" cy="140" r="34" fill="none" stroke={soft} strokeWidth="2" opacity=".8" />
          <circle cx="218" cy="140" r="5" fill={red} />
          <path d="M52 56h48M330 224h48" stroke={red} strokeWidth="3" />
        </>
      )}
      {compact && <rect width="220" height="220" rx="20" fill={paper} />}
      <g transform={compact ? "translate(-58 -35) scale(.62)" : "translate(34 22)"}>
        <HockeyStickF />
        <PuckO />
      </g>
      {compact && <path d="M24 182h172" stroke={red} strokeWidth="4" />}
    </svg>
  );
}

export function PrecisionMark() {
  return (
    <main className="precision-shell">
      <style>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; background: ${paper}; }
        .precision-shell { min-height:100dvh; width:100%; overflow:hidden; color:${ink}; background:${paper}; font-family:"DM Sans","Trebuchet MS",sans-serif; display:flex; flex-direction:column; }
        .precision-top { display:flex; align-items:center; justify-content:space-between; padding:22px 34px 18px; border-bottom:1px solid rgba(17,20,22,.18); gap:18px; }
        .eyebrow { display:flex; align-items:center; gap:10px; font-size:10px; font-weight:800; letter-spacing:.18em; text-transform:uppercase; }
        .dot { width:8px; height:8px; border-radius:50%; background:${red}; display:inline-block; }
        .code { color:#686c68; font-size:10px; letter-spacing:.13em; text-transform:uppercase; }
        .precision-content { flex:1; display:grid; grid-template-columns:minmax(0,1fr) 220px; gap:clamp(22px,5vw,70px); align-items:center; padding:clamp(24px,5vw,58px) clamp(24px,6vw,84px); }
        .wide-panel { min-width:0; } .wide-mark { width:min(100%,560px); height:auto; display:block; filter:drop-shadow(0 14px 16px rgba(17,20,22,.12)); }
        .mark-note { margin:20px 0 0 4px; display:flex; gap:18px; align-items:flex-start; } .rule { width:26px; border-top:3px solid ${red}; margin-top:7px; flex:none; } .mark-note p { margin:0; max-width:430px; font-size:12px; line-height:1.6; color:#555a57; }
        .compact-panel { border-left:1px solid rgba(17,20,22,.17); padding-left:clamp(18px,3vw,30px); } .compact-label { font-size:10px; letter-spacing:.18em; text-transform:uppercase; font-weight:800; margin:0 0 14px; } .compact-mark { width:100%; max-width:220px; display:block; filter:drop-shadow(0 12px 14px rgba(17,20,22,.11)); }
        .label-strip { display:flex; justify-content:space-between; align-items:center; padding:15px 34px 17px; border-top:1px solid rgba(17,20,22,.18); color:#686c68; font-size:10px; text-transform:uppercase; letter-spacing:.15em; } .label-strip strong { color:${ink}; font-size:11px; letter-spacing:.11em; }
        @media (max-width:680px) { .precision-top{padding:18px 20px 15px}.code{display:none}.precision-content{grid-template-columns:1fr;gap:28px;padding:28px 20px 34px}.wide-mark{width:100%}.compact-panel{border-left:0;border-top:1px solid rgba(17,20,22,.17);padding:22px 0 0;display:flex;align-items:center;gap:20px}.compact-mark{width:138px;flex:none}.label-strip{padding:14px 20px}.label-strip span{display:none} }
      `}</style>
      <header className="precision-top"><div className="eyebrow"><span className="dot" /> Front Office / Identity study</div><div className="code">FM—01 &nbsp; • &nbsp; Precision mark</div></header>
      <section className="precision-content">
        <div className="wide-panel"><Mark /><div className="mark-note"><span className="rule" /><p><strong>FO</strong> is built from the gear itself: two proportioned sticks expose their taped knobs, shafts, heels and curved toes; a beveled, rubber-textured puck turns the O into a true rink object.</p></div></div>
        <aside className="compact-panel"><div><p className="compact-label">Compact / patch</p><Mark compact /></div></aside>
      </section>
      <footer className="label-strip"><strong>Front Office Hockey Management</strong><span>League operations, in position</span><span>Black / paper / red</span></footer>
    </main>
  );
}

export default PrecisionMark;