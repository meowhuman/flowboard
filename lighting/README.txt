Public test files from https://github.com/open-stage/python-mvr (tests/), MIT licence (see LICENSE-python-mvr.txt).
capture_demo_show.mvr is a Capture export (MVR 1.4, 76 fixtures). Used here only as a sample for tools/mvr-import.py.

capture-look-*.mvr are generated test looks (python3 tools/make-look-mvrs.py, spec in tools/looks.json): the Capture demo rig plus a colour and dimmer on every fixture. An MVR holds one static picture, so one look is one file; the order of looks (cues) is not stored in MVR. 3D meshes are left out to keep the files small.
mvr-map.json heightLift raises overhead fixtures (>= 3 m) by 2 m so the rig sits near the top of the 9.5 m screen. It applies to every MVR loaded on this board; set byM to 0 to switch it off.
