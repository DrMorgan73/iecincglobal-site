MOTION ARENA — PING PONG
An IEC, Inc. game. First to 11, win by 2.
Build tvfix-1.2.0-singlefile — the TV pages are now SINGLE FILES:
everything the game needs (design + all code) is inside the one page
itself, so there is nothing separate left for a TV browser to fail
to load. The page also heals itself: if the TV is merely slow, it
recovers on its own within 30 seconds, no reload needed. If you
still see a red box after 30 seconds, note its words exactly (or
photograph it) — it names the exact stage that failed.

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
  4. Play with the TV remote: UP / DOWN arrows move your paddle,
     Enter starts the game, serves, and restarts. That is all you
     need for 1 Player vs Computer.

  Phone controller (2-player, needs internet):
  5. On your phone's browser, open:
     https://iecincglobal.com/arena/controller.html
  6. Type the 4-letter room code shown on the TV and tap Join.
  7. Drag on the phone pad to move your paddle — or tap
     "Enable tilt control" and tip the phone. Tap SERVE when the
     game says it is your serve.

  Note: phone-controller play needs an internet connection on both
  the TV and the phone (they meet through the PeerJS cloud).
  Single-player on the TV works from the page alone.

====================================================================
SAMSUNG TV TEST — do this once at the real TV (about 5 minutes)
====================================================================
You need: the TV remote and a phone. No sign-in anywhere.
Report back the NUMBER of any step that fails, plus what the
screen showed instead. Every step has its PASS line.

 1. On the TV, open the "Internet" browser and go to
    https://iecincglobal.com/arena/
    PASS: the game lobby appears on the navy arena page.
    If a red box appears instead, wait 30 seconds — a slow TV
    clears it by itself. If it stays, note its words exactly.
 2. Look at the top-right of the screen.
    PASS: the table fills the screen and a 4-letter room code
    shows at the top. If the code area says phones need internet,
    that is fine — keep going.
 3. Press Enter on the remote (the "1 Player vs Computer" button
    is already selected).
    PASS: the game starts and waits for a serve.
 4. Press Enter again to serve, then use the UP / DOWN arrows.
    PASS: the ball launches and your paddle (left, gold) follows
    the arrows smoothly, with no stutter.
 5. Play one full game against the computer to 11 points
    (win by 2). Use Enter to serve each time.
    PASS: the score climbs, the game ends with a winner screen,
    and Enter ("Play Again") starts a fresh game at 0 : 0.
 6. Go back to the lobby (press M, or choose Back to Lobby).
    On the phone, open https://iecincglobal.com/arena/controller.html
    type the room code from the TV, tap Join.
    PASS: the TV shows your phone's name as the LEFT player and
    dragging on the phone pad moves the TV paddle.
    If it fails: note the phone's message word for word (room not
    found / timed out / other) — TV browsers vary, this is the
    step we most need your report on.
 7. Optional: a second phone joins with the same code.
    PASS: it takes the RIGHT paddle automatically and both
    paddles answer to their own phone.

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
       - 1 Player vs Computer (keyboard arrows / mouse / touch)
       - 2 Players sharing one screen (W/S and arrow keys)
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
TV / keyboard : UP/DOWN or W/S move - Enter start/serve/restart -
                M = back to menu - Esc on the game-over screen = lobby
Mouse / touch : move over the table to move the left paddle, tap to serve
Phone         : drag on the pad, or enable tilt; SERVE button on your serve
Scoring       : first to 11 points, must win by 2. Serve changes
                every 2 points (every point at 10-10).

Developed by IEC, Inc.
