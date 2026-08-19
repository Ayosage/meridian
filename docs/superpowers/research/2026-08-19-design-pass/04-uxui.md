# Premium Board/Tactics Game UX/UI — Research Report

(Research phase 1 of the Meridian design pass — lane: UX/UI. Agent-produced 2026-08-19.)

## 1. Lobby/matchmaking UX (friend-code multiplayer)

- **Code display as a hero element, not a form field.** Jackbox and Among Us treat the room code as the single largest thing on screen — huge type, high contrast, one-tap copy icon adjacent. The code isn't metadata, it's the primary CTA of the create-flow screen.
- **Share as a link, not just a code.** The copy button should copy a full joinable URL (`/join/ABCD`) with the raw 4-letter code shown underneath for verbal entry.
- **Waiting states should be alive, not a spinner.** Animate the code itself (soft pulse/glow); show a joined checkmark the instant the second player lands; optionally give the host a trivial action while waiting (color pick).
- **Rematch should be a single tap that reuses the room** — both players get a Rematch button re-forming the same room instantly. Table-stakes in social games; dramatically increases session length.

## 2. In-match HUD anatomy (turn-based tactics)

- **Whose-turn state deserves a dedicated, unmissable element** — a turn banner/pill with the active player's color swatch + name, top-center, with a felt state change (color shift + brief motion) on handoff.
- **Action affordances contextual to selection**, not a persistent toolbar: select a piece → actions appear; deselect → gone.
- **Confirm-vs-direct:** chess.com/Lichess support both drag (fast, desktop) and click-click (deliberate, touch-safe). For irreversible captures: tap-select then tap-destination as the universal default (origin tap cancels), drag as a desktop enhancement.
- **Undo at the micro level:** allow re-selecting a different piece freely before committing; the committed move is the point of no return (Into the Breach's clarity-over-cool doctrine).
- **Captured-piece tray** in a HUD corner showing actual pieces (trophy case + material count) without competing with the board.
- **Settings/forfeit/leave behind a single top-corner icon** opening a lightweight pause menu with confirm-gated forfeit.
- **Illegal-move feedback should mostly be prevented, not messaged** — illegal targets simply don't accept the move (soft snap-back/shake). Reserve real messages for non-spatial violations ("not your turn"), with three-part anatomy: what happened, why, what to do next. Never a bare "Invalid move."

## 3. Board interaction UX

- **Selection affordance:** selected piece gets outline/glow (not recolor alone — colorblind failure). Legal-move language should be **shape-coded**: small dot on plain legal hexes, ring/outline on capture-eligible hexes (chess.com/Lichess convention) — survives red-green colorblindness with color as secondary reinforcement.
- **Colorblind-safe palette:** avoid red/green as the team pair; blue/orange is the standard safe pairing. Any red "danger" must pair with a distinct shape/icon.
- **Drag vs click-click:** click-click is the robust default for responsive web (fat-finger and camera-gesture conflicts kill drag on touch); drag optional on desktop.
- **Camera:** locked isometric angle with zoom (pinch/scroll) and at most snapped rotation steps — no continuous free orbit. Board legibility and identical reads for both players beat cinematic freedom.

## 4. Game-feel states

- **Turn handoff felt, not displayed** — a brief animated transition (color sweep, banner slide).
- **Capture juice:** pop/flash/particle on the captured piece + animated arrival in the tray — visual + motion + optional haptic, scaled to stakes.
- **Win/lose screens reward, not report:** celebratory animation for the winner, respectful framing for the loser ("Good game" tone), short recap (turns, captures), Rematch + Return CTAs as the two obvious actions.
- **Reconnect/disconnect must not panic:** show "reconnecting…" with a visible grace-period timer for the opponent, hold state, surface forfeit only after the grace lapses — calm copy throughout.

## 5. Onboarding

For a move/capture ruleset, a tutorial mode is overkill. Proportionate: **inline, dismissible, just-in-time hints** on the real first match ("tap a hex to select"; "ring = capture" the first time a capture is legal), disappearing after 1-2 turns or on dismiss (Wingspan/Ticket to Ride digital pattern). Skip ghost-move suggestions — disproportionate engineering.

## 6. Accessibility + responsive

- Blue/orange team colors; every color-coded state reinforced with a non-color cue (shape/icon/motion).
- Respect `prefers-reduced-motion` with genuinely reduced/instant fallbacks.
- Touch targets ≥44×44 CSS px; spacing between adjacent legal-move hexes; zoom defaults tighter on narrow viewports so hexes stay tappable.
- Portrait plan distinct from landscape: banner/action bar collapse to top/bottom safe zones, board fills the middle.

## 7. The 5 highest-leverage UI moves (ranked)

1. **Legal-move visualization system** — dots for moves, rings for captures, shape-driven and colorblind-safe. The single biggest jump in perceived "game-ness."
2. **Turn-state HUD redesign** — proper turn banner with animated handoff. Cheap typography/layout, high "designed" payoff.
3. **Lobby/create-join polish** — oversized one-tap-copy code (doubling as join link), alive waiting state, instant rematch. The product's first impression.
4. **Move/capture juice** — eased slides/arcs, capture pop + tray animation, highlight pulse on the moved hex.
5. **Match-end + leave/forfeit redesign** — real match-end modal (recap + CTAs, respectful loss), calm reconnect grace state, confirm-gated forfeit.

## Sources

- Barricade (App Store): https://apps.apple.com/us/app/barricade-strategy-board-game/id1633764827
- Interface In Game — Into the Breach: https://interfaceingame.com/games/into-the-breach/
- Into the Breach dev on UI design: https://www.gamedeveloper.com/design/-i-into-the-breach-i-dev-on-ui-design-sacrifice-cool-ideas-for-the-sake-of-clarity-every-time-
- Chess.com vs Lichess UI: https://siddhesh.substack.com/p/chesscom-vs-lichess
- Confirm Move Button (chess.com forum): https://www.chess.com/forum/view/general/confirm-move-button
- Colorblind board-game accessibility — Calliope Games: https://calliopegames.com/9699/accomodations-for-color-blind-players/
- Colorblind-friendly game design: https://chrisfairfield.com/unlocking-colorblind-friendly-game-design/
- Error feedback UX — Pencil & Paper: https://www.pencilandpaper.io/articles/ux-pattern-analysis-error-feedback
- Error-tolerant design: https://en.wikipedia.org/wiki/Error-tolerant_design
- Errors in game tutorials — Psychology of Games: https://www.psychologyofgames.com/2018/12/you-screwed-up-the-value-of-errors-in-game-tutorials/
- Entertaining players while waiting — Game Developer: https://www.gamedeveloper.com/design/entertaining-players-while-waiting-for-matchmaking
- Wingspan Digital review: https://gideonsgaming.com/wingspan-digital-edition-european-expansion-review/
- Ticket to Ride app review: https://whatsericplaying.com/2016/06/05/ticket-to-ride-app/
- Accessible target sizes — Smashing: https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/
- WCAG target size — Deque: https://dequeuniversity.com/resources/wcag2.1/2.5.5-target-size
- HUD design guide: https://sunstrikestudios.com/en/blog/HUD_design_in_games/
- Game UI guide: https://gamedesignskills.com/game-design/ui/
- Disconnect handling: https://bugnet.io/blog/how-to-handle-player-disconnects-gracefully
