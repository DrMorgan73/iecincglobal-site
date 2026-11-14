MOTION ARENA — PING PONG
An IEC, Inc. game. Broadcast table tennis: the TV watches the table
from behind your end, with the other player standing at the far end.
Official rules: game to 11, win by 2, match best of 5.
Build relay-1.3.1 — the TV pages are SINGLE FILES:
everything the game needs (design + all code) is inside the one page
itself, so there is nothing separate left for a TV browser to fail
to load. The page also heals itself: if the TV is merely slow, it
recovers on its own within 30 seconds, no reload needed. If you
still see a red box after 30 seconds, note its words exactly (or
photograph it) — it names the exact stage that failed.

WHAT'S NEW IN 1.3.1
  - TWO WAYS FOR PHONES TO REACH THE TV: the phone first tries the
    direct link (WebRTC). If the TV's browser cannot complete that
    kind of connection (Samsung TV browsers do exactly this — the
    TV shows a healthy green light yet phones time out), the phone
    and the TV automatically meet through a relay link instead.
    Nothing to choose and nothing to set: watch the small print —
    the TV's player chip and the phone's status line both say
    DIRECT or RELAY. Both ends just need internet.
  - PLAYER LOOK: every player is a Male or Female figure. Pick
    yours on the phone's join form (next to name and colour), or
    for the TV seats in the lobby (G = you, H = the Computer).
  - LIVELIER PLAYERS AND CROWD: the far player now swings with a
    real wind-up, strike and follow-through, leans and steps as it
    tracks the ball, crouches to receive serve, and reacts to
    points. The crowd ripples after rallies, stands in a wave on
    game wins, and settles on faults and lets — with a generated
    crowd swell if you turn the sound on (it stays off by itself).
  - SHARPER CONTROLS: swings are timed on the phone and stamped
    with their true moment (the phone and TV sync clocks when you
    join), so connection delay no longer eats your PERFECT window;
    tilt is smoothed with a small dead-zone over a wider range, so
    hand tremor stops shaking the bat; and the bat on the TV now
    predicts your stream instead of trailing it.

THE RULES (official table tennis, as the game plays them)
  - Serve: the ball bounces first on the SERVER's half, then on the
    receiver's half. A serve that clips the net and still lands in
    is a LET — re-serve, no point. A serve into the net or off the
    table gives the point to the receiver.
  - Rally: returns must bounce on the opponent's half. Edge balls
    count as in. Hitting the ball before it bounces (a volley) is
    a fault. A net-cord ball that goes over and lands in plays on.
  - Scoring: every rally scores. Serves change every 2 points
    (every point at 10-10). Players switch ends after each game,
    and at 5 points in the deciding game. First to 3 games wins
    the match.

====================================================================
1) PLAY ON THE SAMSUNG TV  (the main way)
====================================================================
A Samsung TV cannot install games from a USB stick — Samsung TVs only
take apps from Samsung's own store. So on the TV, the game runs from
its web address, in the TV's built-in Internet browser:

  1. On the TV, open the "Internet" browser app.
  2. Go to:  https://iecincglobal.com/arena/
     The TV Host opens by itself — no sign-in, nothing to choose.
  3. If a red box appears, give it 30 seconds: a slow TV clears it
     by itself. If it stays, note its words (see the note above).
  4. Play with the TV remote: LEFT / RIGHT arrows move your bat
     (at the bottom of the screen), Enter starts the game, serves,
     and restarts. That is all you need for 1 Player vs Computer.
     In the lobby you can also pick the Computer's difficulty
     (D key) and turn sound on (N key). P pauses.

  Phone controller (needs internet):
  5. On your phone's browser, open:
     https://iecincglobal.com/arena/controller.html
  6. Type the 4-letter room code shown on the TV, your name, your
     colour and your player (Male / Female), and tap Join.
  7. SWING MODE (the fun way): tap SWING MODE, allow motion access
     if the phone asks, hold the phone upright and tap
     "Set upright centre" — keep the phone still for half a second
     while it learns your centre (your swing arms once it is set).
     Tilt the phone left/right to move your bat — and SWING the
     phone forward as the ball reaches you to strike it. The TV
     grades your timing: PERFECT / GOOD / GRAZE.
     TOUCH MODE always works too: drag left/right on the track.
  8. Tap SERVE when the phone says it is your serve (or swing).
     If the connection drops, the phone rejoins by itself and the
     TV holds your player for a minute — no need to restart.

  Note: phone-controller play needs an internet connection on both
  the TV and the phone — they meet through a cloud link (direct
  when the TV's browser allows it, relay when it does not; the
  game picks by itself). Single-player on the TV works from the
  page alone.

====================================================================
SAMSUNG TV TEST — do this once at the real TV (about 5 minutes)
====================================================================
You need: the TV remote and a phone. No sign-in anywhere.
Report back the NUMBER of any step that fails, plus what the
screen showed instead. Every step has its PASS line.

 1. On the TV, open the "Internet" browser and go to
    https://iecincglobal.com/arena/
    PASS: the game lobby appears over the broadcast table view.
    If a red box appears instead, wait 30 seconds — a slow TV
    clears it by itself. If it stays, note its words exactly.
 2. Look at the screen.
    PASS: the table fills the screen (trapezoid view), the other
    player stands at the far end, and a 4-letter room code shows
    at the top right.
 3. Press Enter on the remote (the "1 Player vs Computer" button
    is already selected).
    PASS: the game starts and waits for a serve, your bat at the
    bottom of the screen.
 4. Press Enter again to serve, then use LEFT / RIGHT arrows.
    PASS: the ball launches, bounces on your half then the far
    half, and your bat follows the arrows smoothly.
 5. Play one full game against the computer to 11 points
    (win by 2). Use Enter to serve each time.
    PASS: the corner score boxes climb, the game ends with a
    winner screen, and "Next Game" starts game 2 at 0 : 0 with
    the players at switched ends.
 6. Go back to the lobby (press M). On the phone, open
    https://iecincglobal.com/arena/controller.html
    type the room code from the TV, tap Join, then tap
    SWING MODE and allow motion access.
    PASS: the TV shows your phone's name as a player, tilting
    the phone moves your bat, and swinging strikes the ball with
    a grade (PERFECT / GOOD / GRAZE) flashing on the TV.
    On this TV the phone will most likely join "via relay link"
    (its status line says so, and the TV's player chip says
    RELAY) — that is the expected path here, and joining may
    take a few extra seconds while the relay takes over.
    If it fails: note the phone's message word for word — TV and
    phone browsers vary; this is the step we most need reported.
 7. Optional: a second phone joins with the same code.
    PASS: it becomes the other player automatically and both
    phones play their own ends.

Send back: "TV test passed" or the failing step numbers.

====================================================================
2) PLAY FROM THIS USB STICK  (computer or Galaxy phone/tablet)
====================================================================
This folder is the whole game — nothing is loaded from the internet
for the on-screen game itself.

  Browser route:
  1. Copy this folder (or the ZIP) to the stick / device.
  2. Open "index.html" in any modern browser.
  3. Pick "TV Host" on the biggest screen you have; a second device
     can open "controller.html" for phone play (internet needed
     for that part).
  4. With NO internet at all, these still work fully:
       - 1 Player vs Computer (arrow keys / mouse / touch)
       - 2 Players sharing one screen (Player 1: A/D, Player 2:
         arrow keys)
     Phone-controller mode will simply show a message explaining it
     needs internet — nothing breaks or hangs.

====================================================================
3) ANDROID APP  (Samsung Galaxy phones/tablets)
====================================================================
The file "motion-arena-pingpong.apk" is the game as an Android app
(it wraps the same pages; on-screen play works offline, phone-
controller mode needs internet as above).

  1. Copy the APK to the Galaxy device (USB stick, cable, or send it
     to yourself).
  2. Open it with the device's Files app and tap Install.
  3. Android will ask to allow installs from that source ("unknown
     sources") — allow it for the Files app, then Install.
  4. Open "Motion Arena Ping Pong" from the app drawer.

====================================================================
CONTROLS SUMMARY
====================================================================
TV / keyboard : LEFT/RIGHT (or UP/DOWN) move your bat — Enter
                start/serve/restart — P pause — M menu — in the
                lobby: 1/2/3 pick the game type, D difficulty,
                N sound on/off, G your player's look (Male/Female),
                H the Computer's look. 2 Players: Player 1 A/D,
                Player 2 arrow keys.
Mouse / touch : move over the table to move your bat, tap to serve.
Phone         : SWING MODE — tilt to move, swing to strike (timing
                is graded); TOUCH MODE — drag on the track, the TV
                bats for you at contact; SERVE button on your serve.
Scoring       : game to 11, win by 2; serves change every 2 points
                (every point at 10-10); ends switch after each game
                and at 5 in the deciding game; match = best of 5.

Developed by IEC, Inc.
