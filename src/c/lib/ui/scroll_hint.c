#include "scroll_hint.h"
#include "ui_theme.h"

#define BUB_W     21    // squircle bubble size — odd, so the symmetric (odd-pixel)
#define BUB_H     21    // chevron centers on exactly-equal padding all around
#define BUB_R     6     // corner radius — generous, so it reads as a squircle
#define MARGIN    6     // inset from the frame's right/top/bottom edges

#define CHEV_HW   4     // chevron half-width
#define CHEV_DV   2     // chevron arm-to-apex depth
#define CHEV_GAP  3     // vertical gap between the two stacked chevrons

// Bob animation: a short, decaying bounce toward where the chevron points.
#define FRAME_MS  40
#define FRAMES    30    // ~1.2s total, then rest
#define CYCLES    3     // bobs over the run
#define AMP       4     // peak offset in px

struct ScrollHint {
  Layer          *layer;
  ScrollHintModel model;
  int             frame;     // FRAMES = settled (at rest)
  AppTimer       *timer;
};

// Offset (0..AMP) for the current frame: |sin| so it bobs out and back toward
// the pointing direction, with the amplitude decaying linearly to rest.
static int bob(int frame) {
  if (frame >= FRAMES) return 0;
  int32_t s = sin_lookup((TRIG_MAX_ANGLE * CYCLES * frame) / FRAMES);
  if (s < 0) s = -s;
  int amp = (AMP * (FRAMES - frame)) / FRAMES;
  return (amp * s) / TRIG_MAX_RATIO;
}

static void draw_bubble(GContext *ctx, GRect r, bool down) {
  graphics_context_set_stroke_width(ctx, 1);
  graphics_context_set_fill_color(ctx, ui_background());      // opaque white surface
  graphics_fill_rect(ctx, r, BUB_R, GCornersAll);
  graphics_context_set_stroke_color(ctx, ui_neutral());       // hairline edge vs white bg
  graphics_draw_round_rect(ctx, r, BUB_R);

  graphics_context_set_stroke_color(ctx, ui_text());
  int cx  = r.origin.x + r.size.w / 2;
  int cy  = r.origin.y + r.size.h / 2;
  int dir = down ? 1 : -1;                                     // apex below (down) / above (up)
  cy -= dir * (CHEV_DV / 2);                                   // the apex juts out one way only;
                                                              // shift back so the glyph sits centered
  for (int k = 0; k < 2; k++) {
    int ay = cy + (k == 0 ? -CHEV_GAP : CHEV_GAP);             // arm baseline
    int py = ay + dir * CHEV_DV;                               // apex
    graphics_draw_line(ctx, GPoint(cx - CHEV_HW, ay), GPoint(cx, py));
    graphics_draw_line(ctx, GPoint(cx, py), GPoint(cx + CHEV_HW, ay));
  }
}

static void hint_update(Layer *layer, GContext *ctx) {
  ScrollHint *h = *(ScrollHint **)layer_get_data(layer);
  GRect b = layer_get_bounds(layer);
  int off = bob(h->frame);
  int rx  = b.origin.x + b.size.w - MARGIN - BUB_W;
  if (h->model.down) {
    int y = b.origin.y + b.size.h - MARGIN - BUB_H + off;      // bobs down
    draw_bubble(ctx, GRect(rx, y, BUB_W, BUB_H), true);
  }
  if (h->model.up) {
    int y = b.origin.y + MARGIN - off;                         // bobs up
    draw_bubble(ctx, GRect(rx, y, BUB_W, BUB_H), false);
  }
}

static void tick(void *context) {
  ScrollHint *h = context;
  h->timer = NULL;
  h->frame++;
  layer_mark_dirty(h->layer);
  if (h->frame < FRAMES) h->timer = app_timer_register(FRAME_MS, tick, h);
}

static void restart(ScrollHint *h) {
  h->frame = 0;
  layer_mark_dirty(h->layer);
  if (!h->timer) h->timer = app_timer_register(FRAME_MS, tick, h);
}

ScrollHint *scroll_hint_create(Layer *parent, GRect frame) {
  ScrollHint *h = malloc(sizeof(ScrollHint));
  if (!h) return NULL;
  h->model = (ScrollHintModel){0};
  h->frame = FRAMES;     // start at rest; first scroll_hint_set kicks the bob
  h->timer = NULL;
  h->layer = layer_create_with_data(frame, sizeof(ScrollHint *));
  *(ScrollHint **)layer_get_data(h->layer) = h;
  layer_set_update_proc(h->layer, hint_update);
  layer_add_child(parent, h->layer);
  return h;
}

void scroll_hint_set(ScrollHint *h, ScrollHintModel model) {
  if (!h) return;
  // Bob again whenever a bubble newly appears (e.g. a fresh page that scrolls).
  bool newly = (model.down && !h->model.down) || (model.up && !h->model.up);
  h->model = model;
  if (newly) restart(h);
  else       layer_mark_dirty(h->layer);
}

void scroll_hint_destroy(ScrollHint *h) {
  if (!h) return;
  if (h->timer) app_timer_cancel(h->timer);
  layer_destroy(h->layer);
  free(h);
}
