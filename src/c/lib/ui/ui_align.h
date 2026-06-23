#pragma once
#include <pebble.h>

// =============================================================================
// ui_align — place a fixed-size piece of content inside a box.
//
// Centering content in a box is the most-repeated geometry in the lib: an icon
// in a key, a crown in a cell, a checkbox in a row — all the same
// `origin + (size - content) / 2` by hand, per axis. ui_rect_align does it once
// and hands back the positioned rect, ready for graphics_draw_bitmap_in_rect /
// gpath_move_to / any draw that takes a GRect or its origin.
//
// This is for content whose size is known up front (bitmaps, glyphs, sub-grids).
// Text is NOT one of those: graphics_draw_text is top-aligned and the GOTHIC
// fonts need a per-font cap-box + optical nudge to look centered — that lives in
// ui_text. Align geometrically here; if a glyph needs an optical nudge, add it
// to the returned origin at the call site (this won't guess it for you).
// =============================================================================

typedef enum { UI_ALIGN_START, UI_ALIGN_CENTER, UI_ALIGN_END } UiAlign;

// `content`-sized rect positioned inside `box` per the horizontal/vertical
// alignment. START hugs the left/top edge, END the right/bottom, CENTER splits
// the slack. Content larger than the box overhangs symmetrically when centered.
GRect ui_rect_align(GRect box, GSize content, UiAlign h, UiAlign v);

// Shorthand for the common case: centered on both axes.
static inline GRect ui_rect_center(GRect box, GSize content) {
  return ui_rect_align(box, content, UI_ALIGN_CENTER, UI_ALIGN_CENTER);
}
