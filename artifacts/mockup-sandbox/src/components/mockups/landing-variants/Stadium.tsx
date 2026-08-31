import React from "react";

export default function Stadium() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --ice: #EDF1F4;
          --paper: #FFFFFF;
          --slab: #16202A;
          --slab-2: #1E2C39;
          --steel: #5C6B78;
          --bulb: #F2A93B;
          --crease: #2F6FB5;
          --goal: #B33A2B;
          --rule: #D3DBE2;
          --ink: #0E1620;
        }

        .ice-ellipse-outer {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 900px;
          height: 900px;
          border-radius: 50%;
          border: 1px solid rgba(242, 169, 59, 0.08);
          transform: translate(-50%, -50%);
          pointer-events: none;
        }

        .ice-ellipse-inner {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 540px;
          height: 540px;
          border-radius: 50%;
          border: 1px solid rgba(242, 169, 59, 0.1);
          transform: translate(-50%, -50%);
          pointer-events: none;
        }

        .ice-center-line {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 1px;
          background: rgba(242, 169, 59, 0.06);
          pointer-events: none;
        }
      `}} />
      <div className="min-h-screen bg-[#16202A] text-white font-['Public_Sans'] overflow-x-hidden selection:bg-[#F2A93B] selection:text-[#0E1620]">
        {/* HERO SECTION */}
        <div className="relative min-h-[100vh] flex flex-col items-center justify-center pt-24 pb-20 px-6">
          {/* Background Decor */}
          <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
            <div className="ice-ellipse-outer"></div>
            <div className="ice-ellipse-inner"></div>
            <div className="ice-center-line"></div>
            {/* Spotlights/Glows to add dramatic scale */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#F2A93B] opacity-[0.03] blur-[100px] rounded-full pointer-events-none"></div>
          </div>

          {/* Top Left Wordmark */}
          <div className="absolute top-6 left-6 md:top-10 md:left-10 flex items-center gap-4 z-10">
            <div className="flex items-center gap-3">
              <div className="w-[34px] h-[34px] bg-[#0E1620] flex items-center justify-center text-[#F2A93B] font-['Anton'] text-[18px] leading-none pt-1">
                FO
              </div>
              <div className="font-['Anton'] uppercase text-[20px] text-white tracking-wide pt-1">
                Front Office
              </div>
            </div>
            <div className="hidden sm:block w-px h-6 bg-[rgba(255,255,255,0.1)]"></div>
            <div className="hidden sm:block font-['IBM_Plex_Mono'] text-[#F2A93B] text-[10px] tracking-[0.2em] uppercase pt-[2px]">
              NHL 27 · Connected Franchise
            </div>
          </div>

          {/* Center Content */}
          <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto w-full">
            <div className="font-['IBM_Plex_Mono'] text-[#F2A93B] text-[11px] tracking-[0.2em] uppercase mb-6 sm:mb-8">
              NHL 27 · Connected Franchise
            </div>
            
            <h1 className="font-['Anton'] text-[clamp(72px,10vw,120px)] leading-[0.88] text-white uppercase m-0 p-0 text-shadow-none mb-6">
              FRONT OFFICE
            </h1>
            
            <p className="text-[#9FB1BF] text-[16px] leading-[1.6] max-w-[52ch] mx-auto text-balance">
              The hub for serious GM leagues — standings, scheduling, sign-ups, and the tools commissioners need to run a tight ship.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-[36px] w-full sm:w-auto">
              <button className="w-full sm:w-auto bg-[#F2A93B] hover:bg-[#d99732] text-[#0E1620] font-['Anton'] uppercase text-[12px] tracking-[0.1em] px-[32px] py-[14px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#F2A93B] focus:ring-offset-2 focus:ring-offset-[#16202A]">
                Sign In
              </button>
              <button className="w-full sm:w-auto bg-transparent border border-[#F2A93B] text-[#F2A93B] hover:bg-[rgba(242,169,59,0.1)] font-['Anton'] uppercase text-[12px] tracking-[0.1em] px-[32px] py-[14px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#F2A93B] focus:ring-offset-2 focus:ring-offset-[#16202A]">
                Browse Open Leagues
              </button>
            </div>
          </div>

          {/* Scroll Hint */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 font-['IBM_Plex_Mono'] text-[#F2A93B] text-[10px] tracking-widest uppercase animate-pulse">
            ↓ SCROLL
          </div>
        </div>

        {/* FEATURES BELT */}
        <div className="bg-[#1E2C39] py-[72px] px-6 border-t border-[rgba(255,255,255,0.05)] border-b relative z-10">
          <div className="font-['IBM_Plex_Mono'] text-[#F2A93B] text-[10px] tracking-[0.2em] uppercase text-center mb-[40px]">
            Why Front Office
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-12 gap-x-8 max-w-[1080px] mx-auto">
            {/* Feature 1 */}
            <div className="flex flex-col">
              <div className="text-[40px] leading-none mb-1">📊</div>
              <h3 className="font-['Anton'] uppercase text-[15px] text-white mt-[12px] mb-[6px] tracking-wide">
                Live Standings
              </h3>
              <p className="text-[#9FB1BF] text-[13px] leading-[1.5] max-w-full sm:max-w-[28ch]">
                Real-time NHL-style standings table with GP, W, L, OTL, PTS, and tiebreakers.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="flex flex-col">
              <div className="text-[40px] leading-none mb-1">📅</div>
              <h3 className="font-['Anton'] uppercase text-[15px] text-white mt-[12px] mb-[6px] tracking-wide">
                Auto-Balanced Scheduling
              </h3>
              <p className="text-[#9FB1BF] text-[13px] leading-[1.5] max-w-full sm:max-w-[28ch]">
                Generates a fair home/away schedule for the whole season instantly.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="flex flex-col">
              <div className="text-[40px] leading-none mb-1">📋</div>
              <h3 className="font-['Anton'] uppercase text-[15px] text-white mt-[12px] mb-[6px] tracking-wide">
                GM Sign-Ups
              </h3>
              <p className="text-[#9FB1BF] text-[13px] leading-[1.5] max-w-full sm:max-w-[28ch]">
                Application flow with commissioner review and integrated waitlist management.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="flex flex-col">
              <div className="text-[40px] leading-none mb-1">🛠️</div>
              <h3 className="font-['Anton'] uppercase text-[15px] text-white mt-[12px] mb-[6px] tracking-wide">
                Commissioner Tools
              </h3>
              <p className="text-[#9FB1BF] text-[13px] leading-[1.5] max-w-full sm:max-w-[28ch]">
                Decline notes, reorder waitlists, audit logs, and data-quality dashboards.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="flex flex-col">
              <div className="text-[40px] leading-none mb-1">🔗</div>
              <h3 className="font-['Anton'] uppercase text-[15px] text-white mt-[12px] mb-[6px] tracking-wide">
                Invite System
              </h3>
              <p className="text-[#9FB1BF] text-[13px] leading-[1.5] max-w-full sm:max-w-[28ch]">
                One-click invite links with automated expiry and revocation controls.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="flex flex-col">
              <div className="text-[40px] leading-none mb-1">🌐</div>
              <h3 className="font-['Anton'] uppercase text-[15px] text-white mt-[12px] mb-[6px] tracking-wide">
                Open Directory
              </h3>
              <p className="text-[#9FB1BF] text-[13px] leading-[1.5] max-w-full sm:max-w-[28ch]">
                Public browse page for fans to find and apply to actively recruiting leagues.
              </p>
            </div>
          </div>
        </div>

        {/* ENTRY CARDS */}
        <div className="bg-[#EDF1F4] py-[56px] px-6 text-[#16202A] relative z-10">
          <div className="font-['IBM_Plex_Mono'] text-[#5C6B78] text-[10px] tracking-[0.2em] uppercase text-center mb-[32px]">
            Get Started
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-[1080px] mx-auto">
            {/* Card 1: Sign In */}
            <div className="bg-white border border-[#16202A] rounded-[4px] p-[20px] flex flex-col justify-between shadow-sm min-h-[160px]">
              <div>
                <h4 className="font-['Anton'] uppercase text-[16px] text-[#16202A] mb-2 tracking-wide">
                  Commissioner / GM Sign In
                </h4>
                <p className="text-[#5C6B78] text-[13px] leading-[1.5] mb-6">
                  Manage your active leagues, review applications, and update schedules.
                </p>
              </div>
              <button className="w-full bg-[#16202A] hover:bg-[#0E1620] text-white font-['Anton'] uppercase text-[12px] tracking-[0.1em] py-[12px] transition-colors rounded-[2px]">
                Sign In
              </button>
            </div>

            {/* Card 2: Browse */}
            <div className="bg-white border border-[#D3DBE2] rounded-[4px] p-[20px] flex flex-col justify-between shadow-sm min-h-[160px]">
              <div>
                <h4 className="font-['Anton'] uppercase text-[16px] text-[#16202A] mb-2 tracking-wide">
                  Browse Open Leagues
                </h4>
                <p className="text-[#5C6B78] text-[13px] leading-[1.5] mb-6">
                  Looking for a team? Browse leagues that are currently recruiting GMs.
                </p>
              </div>
              <button className="w-full bg-white border border-[#16202A] hover:bg-gray-50 text-[#16202A] font-['Anton'] uppercase text-[12px] tracking-[0.1em] py-[12px] transition-colors rounded-[2px]">
                View Open Leagues
              </button>
            </div>

            {/* Card 3: Code */}
            <div className="bg-white border border-[#D3DBE2] rounded-[4px] p-[20px] flex flex-col justify-between shadow-sm min-h-[160px]">
              <div>
                <h4 className="font-['Anton'] uppercase text-[16px] text-[#16202A] mb-2 tracking-wide">
                  Have a League Code?
                </h4>
                <p className="text-[#5C6B78] text-[13px] leading-[1.5] mb-4">
                  Enter your league's short code to jump directly to its public page.
                </p>
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="e.g. RUSTBELT" 
                  className="w-full border border-[#D3DBE2] rounded-[2px] px-3 py-2 text-[14px] font-['IBM_Plex_Mono'] uppercase focus:outline-none focus:border-[#16202A] placeholder:text-[#9FB1BF] text-[#16202A]"
                />
                <button className="bg-[#16202A] hover:bg-[#0E1620] text-white font-['Anton'] uppercase text-[12px] tracking-[0.1em] px-4 py-[12px] transition-colors rounded-[2px]">
                  Go
                </button>
              </div>
            </div>

            {/* Card 4: Invite */}
            <div className="bg-white border border-[#D3DBE2] rounded-[4px] p-[20px] flex flex-col shadow-sm min-h-[160px]">
              <h4 className="font-['Anton'] uppercase text-[16px] text-[#16202A] mb-2 tracking-wide">
                Got an Invite Link?
              </h4>
              <p className="text-[#5C6B78] text-[13px] leading-[1.5]">
                Invite links automatically redirect to the sign-up page for the target league. Ensure you are signed in first, then click the link provided by your commissioner.
              </p>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <footer className="bg-[#16202A] h-[50px] flex items-center justify-center border-t border-[rgba(255,255,255,0.05)] relative z-10">
          <div className="font-['IBM_Plex_Mono'] text-[#5C6B78] text-[10px] tracking-widest uppercase">
            © 2026 Front Office
          </div>
        </footer>
      </div>
    </>
  );
}
