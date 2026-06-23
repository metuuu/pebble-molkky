#pragma once
#include <pebble.h>

// =============================================================================
// ui_section — the app's one section-header style: a dithered light-gray band
// with a white, rounded title chip (CAPTION_BOLD). Shared by the interactive
// menu/list (list_core) and the static view so every titled group — settings,
// results, anywhere — looks identical.
//
// `gap_above` adds a blank run of list background above the band, used to space
// a section off the rows before it. Pass false for the first section, or when
// the caller already inserts its own spacing (e.g. the view's block_gap).
// =============================================================================

int16_t ui_section_height(bool gap_above);
void    ui_section_draw(GContext *ctx, GRect bounds, const char *title, bool gap_above);
