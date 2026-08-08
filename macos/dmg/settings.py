# dmgbuild settings for the Sidenote disk image.
#
# dmgbuild writes the .DS_Store that positions these icons directly, which is
# the whole reason it is here: every other recipe for a laid-out DMG drives
# Finder over AppleScript, and that throws a "wants access to control Finder"
# prompt on the build machine.
#
# Without the layout you get two unlabelled icons in a bare window, and the
# one thing the user is supposed to do — drag left onto right — is the one
# thing nothing on screen says.
import os

app = defines.get("app", "Sidenote.app")  # noqa: F821 — dmgbuild injects this
name = os.path.basename(app)

format = "UDZO"
compression_level = 9
volume_name = "Sidenote"

files = [app]
symlinks = {"Applications": "/Applications"}

# Icon centres. The background art draws its arrow through the gap between
# them, so these two numbers and that image have to move together.
icon_locations = {
    name: (160, 190),
    "Applications": (480, 190),
}

background = defines.get("background", "background.tiff")  # noqa: F821

default_view = "icon-view"
icon_size = 112
text_size = 12
window_rect = ((200, 180), (640, 400))

# A plain window: no toolbar, no sidebar, nothing to click but the two icons.
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
arrange_by = None
grid_spacing = 100
label_pos = "bottom"
include_icon_view_settings = True
include_list_view_settings = False
