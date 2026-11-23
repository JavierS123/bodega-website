import { ImageResponse } from "next/og";

export const alt = "BodegaOS — AI cashier & business intelligence for a neighborhood shop";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CHIPS = ["Next.js 16", "Supabase Postgres", "Drizzle", "Gemini AI", "Telegram bot", "Recharts BI"];

/**
 * Social preview card (OpenGraph + Twitter fallback). Static on purpose — no
 * live data in a cached share image.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0b0b0b 0%, #172238 100%)",
          color: "#f0efec",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "#2a78d6", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" />
              <path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" />
              <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
            </svg>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>BodegaOS</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2, maxWidth: 980 }}>
            AI cashier &amp; business intelligence for a real neighborhood shop
          </div>
          <div style={{ fontSize: 28, color: "#c3c2b7", maxWidth: 960, lineHeight: 1.35 }}>
            “Fiado para Mariana: 2 platanitos y 1 chinoto” → an editable, auditable sale in one tap.
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {CHIPS.map((c) => (
            <div key={c} style={{ display: "flex", padding: "10px 20px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)", fontSize: 22, color: "#f0efec" }}>
              {c}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
