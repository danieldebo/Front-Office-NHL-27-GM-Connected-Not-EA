import React from 'react';

export default function Broadcast() {
  return (
    <div className="min-h-screen bg-[#EDF1F4] font-['Public_Sans'] flex flex-col">
      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .marquee-track {
          display: flex;
          width: max-content;
          animation: marquee 20s linear infinite;
        }
      `}</style>
      
      {/* Top Nav Bar */}
      <nav className="h-12 bg-[#16202A] flex items-center justify-between px-6 flex-shrink-0 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-[#F2A93B] text-[#16202A] font-['Anton'] flex items-center justify-center text-[15px] pt-0.5 rounded-sm">
            FO
          </div>
          <span className="font-['Anton'] text-white text-[18px] tracking-wide uppercase mt-0.5">Front Office</span>
        </div>
        <div className="font-['IBM_Plex_Mono'] text-[10px] text-[#F2A93B] tracking-[0.1em] uppercase hidden sm:block">
          NHL 27 · Connected Franchise
        </div>
      </nav>

      {/* Hero Split */}
      <div className="flex flex-col md:flex-row w-full min-h-[calc(100vh-48px)]">
        {/* Left Column */}
        <div className="flex-1 bg-[#16202A] pt-[80px] pb-[80px] pl-[48px] pr-[60px] flex flex-col overflow-hidden relative">
          <div className="w-full mb-10 overflow-hidden">
            <div className="h-[3px] bg-[#F2A93B] w-full mb-3" />
            <div className="overflow-hidden whitespace-nowrap">
              <div className="marquee-track">
                <span className="font-['IBM_Plex_Mono'] text-[9px] text-[#F2A93B] tracking-[0.15em] uppercase pr-8">
                  NHL CONNECTED FRANCHISE · SEASON 27 · GM LEAGUE MANAGEMENT PLATFORM
                </span>
                <span className="font-['IBM_Plex_Mono'] text-[9px] text-[#F2A93B] tracking-[0.15em] uppercase pr-8">
                  NHL CONNECTED FRANCHISE · SEASON 27 · GM LEAGUE MANAGEMENT PLATFORM
                </span>
                <span className="font-['IBM_Plex_Mono'] text-[9px] text-[#F2A93B] tracking-[0.15em] uppercase pr-8">
                  NHL CONNECTED FRANCHISE · SEASON 27 · GM LEAGUE MANAGEMENT PLATFORM
                </span>
                <span className="font-['IBM_Plex_Mono'] text-[9px] text-[#F2A93B] tracking-[0.15em] uppercase pr-8">
                  NHL CONNECTED FRANCHISE · SEASON 27 · GM LEAGUE MANAGEMENT PLATFORM
                </span>
              </div>
            </div>
          </div>
          
          <h1 className="font-['Anton'] text-white uppercase text-[clamp(64px,8vw,108px)] leading-[0.88] mt-10 tracking-tight">
            Front Office
          </h1>
          
          <div className="mt-10 border-l-[3px] border-[#F2A93B] pl-4">
            <p className="text-[#9FB1BF] text-[15px] leading-[1.6] max-w-[400px]">
              The hub for serious GM leagues — standings, scheduling, sign-ups, and the tools commissioners need to run a tight ship.
            </p>
          </div>
          
          <div className="mt-12 flex gap-10 flex-wrap">
            <div>
              <div className="font-['Anton'] text-[28px] text-[#F2A93B] tracking-wide">100+</div>
              <div className="font-['IBM_Plex_Mono'] text-[9px] text-[#5C6B78] uppercase tracking-wider mt-1">Leagues</div>
            </div>
            <div>
              <div className="font-['Anton'] text-[28px] text-[#F2A93B] tracking-wide">500K+</div>
              <div className="font-['IBM_Plex_Mono'] text-[9px] text-[#5C6B78] uppercase tracking-wider mt-1">Games</div>
            </div>
            <div>
              <div className="font-['Anton'] text-[28px] text-[#F2A93B] tracking-wide">10+</div>
              <div className="font-['IBM_Plex_Mono'] text-[9px] text-[#5C6B78] uppercase tracking-wider mt-1">Seasons</div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex-1 bg-[#1E2C39] py-[40px] px-[48px] flex flex-col justify-center gap-4">
          <div className="font-['IBM_Plex_Mono'] text-[9px] text-[#F2A93B] uppercase tracking-[0.15em] mb-2">
            Get Started
          </div>

          {/* Card 1 */}
          <div className="bg-[#F2A93B]/5 border border-white/10 border-l-[3px] border-l-[#F2A93B] rounded-[3px] p-[16px] px-[18px] flex items-center gap-[14px]">
            <div className="text-[20px] leading-none">🏒</div>
            <div className="flex-1">
              <div className="font-['Anton'] text-[14px] text-white uppercase tracking-wide mt-0.5">Commissioner / GM Sign In</div>
              <div className="text-[12px] text-[#9FB1BF] mt-0.5">Manage your existing league</div>
            </div>
            <button className="bg-[#F2A93B] hover:bg-[#d99532] text-[#16202A] font-['Anton'] text-[14px] uppercase tracking-wider px-4 py-2 rounded-[2px] transition-colors mt-0.5">
              Sign In
            </button>
          </div>

          {/* Card 2 */}
          <div className="bg-white/[0.04] border border-white/10 rounded-[3px] p-[16px] px-[18px] flex items-center gap-[14px]">
            <div className="text-[20px] leading-none">📋</div>
            <div className="flex-1">
              <div className="font-semibold text-white text-[15px]">Browse Open Leagues</div>
              <div className="text-[12px] text-[#9FB1BF] mt-0.5">Find a league currently recruiting</div>
            </div>
            <button className="text-[#2F6FB5] hover:text-[#4a8cd2] font-bold text-[14px] transition-colors flex items-center gap-1">
              View &rarr;
            </button>
          </div>

          {/* Card 3 */}
          <div className="bg-white/[0.04] border border-white/10 rounded-[3px] p-[16px] px-[18px] flex items-center gap-[14px] flex-wrap sm:flex-nowrap">
            <div className="text-[20px] leading-none">🔑</div>
            <div className="flex-1 min-w-[120px]">
              <div className="font-semibold text-white text-[15px]">Have a Code?</div>
              <div className="text-[12px] text-[#9FB1BF] mt-0.5">Enter league join code</div>
            </div>
            <div className="flex">
              <input type="text" placeholder="RUSTBELT" className="bg-[#16202A] border border-white/10 border-r-0 text-white text-[13px] px-3 py-1.5 w-24 outline-none focus:border-[#F2A93B] rounded-l-[3px] placeholder:text-[#5C6B78] uppercase font-['IBM_Plex_Mono']" />
              <button className="bg-[#2F6FB5] hover:bg-[#255a93] text-white text-[13px] px-3 py-1.5 font-bold rounded-r-[3px] transition-colors">
                Go
              </button>
            </div>
          </div>

          {/* Card 4 */}
          <div className="bg-white/[0.04] border border-white/10 rounded-[3px] p-[16px] px-[18px] flex items-center gap-[14px]">
            <div className="text-[20px] leading-none">✉️</div>
            <div className="flex-1">
              <div className="font-semibold text-white text-[15px]">Got an Invite Link?</div>
              <div className="text-[12px] text-[#9FB1BF] mt-0.5">Click your link to claim your seat</div>
            </div>
          </div>
          
        </div>
      </div>

      {/* Features Section */}
      <div className="bg-[#EDF1F4] py-[80px] px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="mb-[48px]">
            <h2 className="font-['Anton'] text-[48px] text-[#16202A] uppercase leading-none tracking-wide">Why Front Office</h2>
            <p className="text-[#5C6B78] text-[14px] mt-3">Everything a commissioner needs to run a serious GM league.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard 
              icon="📊" 
              title="Live Standings" 
              desc="Real-time NHL-style standings table with GP, W, L, OTL, PTS, and tiebreakers." 
            />
            <FeatureCard 
              icon="📅" 
              title="Auto-Balanced Scheduling" 
              desc="Generates a fair home/away schedule for the whole season instantly." 
            />
            <FeatureCard 
              icon="📋" 
              title="GM Sign-Ups & Waitlist" 
              desc="Application flow with commissioner review and structured waitlist management." 
            />
            <FeatureCard 
              icon="🛠️" 
              title="Commissioner Toolkit" 
              desc="Decline notes, reorder waitlists, audit logs, and data-quality dashboards." 
            />
            <FeatureCard 
              icon="🔗" 
              title="Invite System" 
              desc="One-click invite links with expiry, revocation, and secure role claims." 
            />
            <FeatureCard 
              icon="🌐" 
              title="Open League Directory" 
              desc="Public browse page for fans to find active recruiting leagues." 
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="h-[50px] bg-white border-t border-[#D3DBE2] flex items-center justify-center flex-shrink-0">
        <div className="font-['IBM_Plex_Mono'] text-[10px] text-[#5C6B78] uppercase tracking-wider">
          © 2026 Front Office · Built for serious GM leagues
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string, title: string, desc: string }) {
  return (
    <div className="bg-white border border-[#D3DBE2] border-t-[3px] border-t-[#F2A93B] rounded-[4px] p-[24px] shadow-sm flex flex-col">
      <div className="text-[28px] leading-none">{icon}</div>
      <h3 className="font-['Anton'] text-[15px] text-[#0E1620] uppercase mt-[10px] mb-[6px] tracking-wide">{title}</h3>
      <p className="text-[13px] text-[#5C6B78] leading-[1.5]">{desc}</p>
    </div>
  );
}
