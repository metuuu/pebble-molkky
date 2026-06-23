#pragma once
#include <pebble.h>

// =============================================================================
// scroll_hint — a pair of corner affordances overlaid on a scrollable screen.
// A squircle "bubble" (opaque surface fill + hairline border, so it stays
// legible over scrolling content) holding a double chevron: bottom-right
// pointing down ("more below / next page"), top-right pointing up ("more above
// / previous page"). Each bubble shows only when its flag is set.
//
// On becoming visible a bubble bobs a few times toward where it points, then
// rests — a finite nudge, not a forever-animation (the watch stops redrawing
// once it settles). A passive overlay, like footer: create it over a window's
// root layer (above the scroll/content), update its model when the scroll
// position or page neighbors change, and destroy it on unload.
//
// `frame` is the region the bubbles tuck into the corners of — pass the content
// area (window minus any bottom band) so the down bubble sits above that band.
// =============================================================================

typedef struct {
  bool down;   // show the bottom-right down bubble
  bool up;     // show the top-right up bubble
} ScrollHintModel;

typedef struct ScrollHint ScrollHint;

ScrollHint *scroll_hint_create(Layer *parent, GRect frame);
void        scroll_hint_set(ScrollHint *h, ScrollHintModel model);
void        scroll_hint_destroy(ScrollHint *h);
