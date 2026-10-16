ASHLINE: BLACK CELL — GitHub Pages setup
========================================

IMPORTANT
---------
The game code in index.html has not been edited. This package only adds
documentation files.

UPLOAD TO GITHUB
----------------
1. Download and extract this ZIP on your computer.
2. Open the extracted ashline_github_upload folder.
3. Upload index.html to the ROOT of your GitHub repository.
   README.txt and TROUBLESHOOTING.txt are optional documentation files.
4. On GitHub, open Settings -> Pages.
5. Under Build and deployment, choose "Deploy from a branch".
6. Select branch "main" and folder "/ (root)", then Save.
7. Wait for the Pages deployment to finish, then open the published URL.

Do not upload the ZIP itself as the website source. Extract it first.
The entry page must be named exactly index.html (lowercase).

DEPENDENCY NOTE
---------------
This HTML loads Three.js from a CDN:
https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js

An internet connection is required for that library to load. If the CDN is
blocked or unavailable, the game may show a blank screen or fail to start.

TEST STATUS
-----------
The JavaScript syntax was checked separately, but the game has not been
verified in a real browser or on GitHub Pages. If it still errors, send the
exact error text or a screenshot of the browser Console (F12 -> Console).
