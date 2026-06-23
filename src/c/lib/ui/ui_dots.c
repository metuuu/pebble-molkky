#include "ui_dots.h"
#include "ui_theme.h"

#define DOT_R     3       // radius of the active dot
#define DOT_PITCH 10      // center-to-center spacing

// Floating style: the dots sit inside a rounded "island" — a filled pill with a
// muted border that floats over the content. PILL_H sets the island height (its
// corner radius is half that, giving fully rounded "( )" ends); PILL_PAD_X is the
// gap between the end dots and the rounded caps. PILL_LIFT nudges the whole
// island up off the bottom edge so it reads as floating.
#define PILL_H      15
#define PILL_PAD_X  9
#define PILL_LIFT   2

static void draw_dots(GContext *ctx, int first_cx, int y, int count, int active) {
  for (int i = 0; i < count; i++) {
    GPoint c = GPoint(first_cx + i * DOT_PITCH, y);
    if (i == active) {
      graphics_context_set_fill_color(ctx, ui_accent());
      graphics_fill_circle(ctx, c, DOT_R);
    } else {
      graphics_context_set_fill_color(ctx, ui_text_muted());
      graphics_fill_circle(ctx, c, DOT_R - 1);
    }
  }
}

void ui_dots_draw(GContext *ctx, GRect box, int count, int active, UiDotsStyle style) {
  if (count <= 1) return;
  int span = (count - 1) * DOT_PITCH;
  int y = box.origin.y + box.size.h / 2;

  if (style != UI_DOTS_FLOATING) {
    int first = box.origin.x + box.size.w / 2 - span / 2;
    draw_dots(ctx, first, y, count, active);
    return;
  }

  y -= PILL_LIFT;                                                // float off the bottom

  // A pill wide enough for the dot row plus a padded cap on each end, centered.
  int pill_w = span + 2 * PILL_PAD_X;
  int pill_x = box.origin.x + box.size.w / 2 - pill_w / 2;
  int pill_y = y - PILL_H / 2;
  GRect pill = GRect(pill_x, pill_y, pill_w, PILL_H);
  int radius = PILL_H / 2;

  graphics_context_set_fill_color(ctx, ui_background());        // solid island
  graphics_fill_rect(ctx, pill, radius, GCornersAll);
  graphics_context_set_stroke_color(ctx, ui_neutral());         // light-gray hairline border
  graphics_draw_round_rect(ctx, pill, radius);

  draw_dots(ctx, pill_x + PILL_PAD_X, y, count, active);
}
