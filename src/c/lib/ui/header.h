#pragma once
#include <pebble.h>

// =============================================================================
// header — a status bar pinned to the TOP of a window: a page title on the left
// and an optional live clock on the right (following the watch's 12/24h setting).
// The mirror of footer.h. Passive Layer that draws its model and refreshes the
// clock once a minute on its own. No focus, no interaction.
//
// Reserve HEADER_H at the top of the window for it; place the content area below
// it at y = HEADER_H with height (window height - HEADER_H). Unlike the footer
// (one ever live, on the game board), headers stack with menus, so the minute
// tick fans out to every live header — hidden ones redraw cheaply under the top
// window.
// =============================================================================

#define HEADER_H 24

typedef struct Header Header;

// Create a header pinned to the top of `parent` (a window's root layer) and add
// it as a child. `title` is copied. The first live header subscribes the minute
// tick; the last to be destroyed unsubscribes.
Header *header_create(Layer *parent, const char *title);
void    header_set_title(Header *h, const char *title);
void    header_destroy(Header *h);
