# AIrecruit — 5 Selectable UI Templates (P4 design system)

Resolves the "5 selectable UI templates" item from Pending Inputs
without waiting on the blueprint PDFs — defined here against the
~100-vendor competitor landscape in
`docs/competitor_landscape_and_feature_blueprint.md` so P4 (Frontend
Foundation) can build the theme-switcher infrastructure immediately.
The 5 templates apply across all 6 modules (T1-T6: Command Center,
Kanban, Candidate 360, Analytics, CEO War Room, Finance/ERP) — same
data, same routes, different look/density. User picks one in Settings
and can switch anytime (persisted).

## The 5 templates

### 1. Enterprise Classic
- **Inspired by**: Bullhorn, JobDiva, Ceipal, TempWorks, Avionté, COATS, AkkenCloud, PCRecruiter
- **Visual identity**: navy/grey corporate palette, dense data grids, top-nav + left sidebar, tabbed forms, inline-editable tables
- **Density**: high (column-heavy, power-recruiter grids)
- **Best for**: agencies migrating off Bullhorn/JobDiva — near-zero retraining

### 2. Modern SaaS
- **Inspired by**: Greenhouse, Lever, Ashby, Crelate, Recruiterflow, Manatal
- **Visual identity**: card-based layouts, soft shadows, rounded corners, indigo/teal accents, generous whitespace
- **Density**: medium
- **Best for**: tech-forward/startup staffing teams, default "modern" feel

### 3. Minimal / Focus
- **Inspired by**: Ashby's minimalist mode, Workable, Linear-style productivity tools
- **Visual identity**: monochrome + single accent color, flat icons, no decorative chrome, dark-mode-first
- **Density**: high but uncluttered — built around the Cmd+K command palette (already in QA spec)
- **Best for**: power users living in keyboard shortcuts

### 4. AI Command Center
- **Inspired by**: Eightfold AI, SeekOut, hireEZ, Paradox — AI-insight-card UIs, fit-score badges, recommendation rails, chat-panel-first layouts
- **Visual identity**: gradient "AI insight" cards, fit-score progress rings, embedded assistant/chat panel surfaced on every screen
- **Density**: medium, AI-insight-first
- **Best for**: agencies that want the zero-token AI cascade (match scores, auto-assign explanations, JD generation, screening chat) to be the headline UX — this is where the "$0 marginal AI cost" story is most visible

### 5. Mobile-First / Field
- **Inspired by**: JobAdder mobile, Bullhorn mobile app, TextUs mobile-first messaging
- **Visual identity**: bottom tab nav, large touch targets, swipeable candidate cards for quick screening, single-column forms
- **Density**: low, mobile-optimized
- **Best for**: field recruiters managing pipeline + WhatsApp outreach on a phone

## Competitor-coverage check
Confirms the 5 templates collectively span every major UI paradigm
seen across the ~100-vendor landscape — no dominant competitor style
is left unrepresented:

| Competitor category | Dominant UI paradigm | Covered by |
|---|---|---|
| Staffing ATS/CRM (Bullhorn, JobDiva, Ceipal, TempWorks...) | dense grids, tabbed forms | Template 1 |
| Enterprise ATS (Greenhouse, Lever, Ashby, Workable...) | card-based, modern, whitespace | Templates 2 & 3 |
| AI sourcing/intelligence (SeekOut, hireEZ, Eightfold, Loxo...) | insight cards, fit scores, AI rails | Template 4 |
| Conversational AI (Paradox, XOR, Mya, Sense) | embedded chat panels | Template 4 |
| Mobile/SMS-first (JobAdder mobile, TextUs) | bottom-nav, swipe cards | Template 5 |
| Minimal/keyboard-driven (Ashby focus mode, Linear) | command palette, monochrome | Template 3 |

## Implementation approach (P4)
Reuse the proven pattern from the sister FinStack HR/Payroll product's
theme switcher (battle-tested, purely additive, zero regression risk):
- `data-theme` attribute on `<html>` — one of `enterprise | modern |
  minimal | ai-command | mobile-first`
- Zustand `persist` store (`uiStore.theme` / `setTheme`,
  `localStorage` key `airecruit-theme`, `partialize`d so only `theme`
  persists)
- `tailwind.config.ts`: per-template color groups
  (`primary/primary-dark/secondary/accent`) + a `tailwindcss/plugin`
  registering `theme-modern:` / `theme-minimal:` / `theme-ai-command:`
  / `theme-mobile:` variants (`[data-theme="..."] &`) — default
  `enterprise` theme's output stays the baseline, so adding variants
  never breaks existing Playwright tests
- Themed surfaces: `Button`, `Modal`/`ConfirmDialog`, `Table`,
  `Sidebar`/bottom-nav (Template 5 swaps to bottom tabs below a
  breakpoint), `Topbar`, chart color maps, plus an "AI insight card"
  component that's hero-treated only in Template 4
- New `components/ui/ThemeSwitcher.tsx` — 5 swatch cards
  (`data-theme-option="enterprise|modern|minimal|ai-command|mobile-first"`
  for Playwright targeting), added to Settings → Appearance

## Status
This doc satisfies the "5 selectable UI templates" requirement in
`FINSTACK_MASTER_INDEX.md` Pending Inputs — P4 is unblocked on this
point. The 5 blueprint PDFs (if/when provided) can refine per-template
details but should not change the count or the theme-switcher
mechanism above.
