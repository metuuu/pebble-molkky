#include "pager.h"
#include "scrollview.h"
#include "ui_dots.h"
#include "ui_theme.h"

#define PAGER_MAX  12     // cap on pages
#define DOTS_BAND  18     // height of the bottom pagination band
#define REPEAT_MS  100    // held-button repeat interval (matches scrollview)

// The pager owns paging + the dots band and embeds a Scrollview for the content
// area: each page's draw/measure is handed to the scrollview, which owns the
// scroll offset and the scroll affordance. Up/Down scroll the current page; at an
// edge (scrollview_scroll returns false) we turn the page instead.
struct Pager {
  Window       *window;
  Scrollview   *sv;       // content area: the current page, scrolled
  Layer        *dots;     // bottom pagination band
  Page         *pages;
  int           n;
  int           cur;
  int           width;
  int           viewport_h;   // window height minus the dots band
  UiDotsStyle   dots_style;   // footer (divider + bare dots) or floating ( o o o )
  AppTimer     *timer;        // hold-scroll repeat (NULL = idle)
  ScrollviewDir dir;          // direction of the current hold
  bool          holding;      // is a button being held (long-press in progress)?
};

// --- drawing -----------------------------------------------------------------
static void dots_update(Layer *layer, GContext *ctx) {
  Pager *p = *(Pager **)layer_get_data(layer);
  GRect b = layer_get_bounds(layer);
  if (p->dots_style == UI_DOTS_FOOTER) {                        // hairline divider
    graphics_context_set_stroke_color(ctx, ui_text_muted());
    graphics_draw_line(ctx, GPoint(b.origin.x, b.origin.y),
                       GPoint(b.origin.x + b.size.w - 1, b.origin.y));
  }
  ui_dots_draw(ctx, b, p->n, p->cur, p->dots_style);
}

// --- state -------------------------------------------------------------------
static void show_page(Pager *p, int idx, bool at_bottom) {
  if (idx < 0 || idx >= p->n) return;
  p->cur = idx;
  Page *pg = &p->pages[idx];
  scrollview_set_content(p->sv, (ScrollviewContent){
    .draw = pg->draw, .measure = pg->measure, .content_h = pg->height, .data = pg->data,
  }, at_bottom);
  layer_mark_dirty(p->dots);
}

// --- input -------------------------------------------------------------------
// Two debounced, non-repeating recognizers, so a hold can NEVER turn a page:
//   * Tap (single click, fires once) — scroll one step; if already at the edge,
//     turn one page (forward → next page's top, back → previous's bottom).
//   * Hold (long click: down once, up once) — scroll continuously via our timer.
//     This path has no page turn in it at all, so holding only ever scrolls the
//     current page and stops dead at the edge. To cross a page you tap.
// HOLD_MS is the tap/hold boundary: a press shorter than this is a tap (so it can
// turn), longer is a hold (scroll only). It's generous so normal taps register as
// taps — too short and a "tap" gets read as a hold and can't turn (the old stuck
// bug). Lower it for snappier hold-scroll, raise it if taps don't register.
#define HOLD_MS 400

static void scroll_repeat(void *context) {
  Pager *p = context;
  if (p->holding && scrollview_scroll(p->sv, p->dir))     // still held and moved → keep going
    p->timer = app_timer_register(REPEAT_MS, scroll_repeat, p);
  else
    p->timer = NULL;                                      // released or at the edge → stop (no turn)
}
static void tap(Pager *p, ScrollviewDir dir) {
  if (!scrollview_scroll(p->sv, dir))                     // at the edge → turn one page
    show_page(p, dir == SCROLLVIEW_DOWN ? p->cur + 1 : p->cur - 1, dir == SCROLLVIEW_UP);
}
static void down_tap(ClickRecognizerRef ref, void *context) { tap(context, SCROLLVIEW_DOWN); }
static void up_tap(ClickRecognizerRef ref, void *context)   { tap(context, SCROLLVIEW_UP); }
static void hold_begin(Pager *p, ScrollviewDir dir) {
  p->holding = true; p->dir = dir;
  scrollview_scroll(p->sv, dir);                          // immediate first step
  if (!p->timer) p->timer = app_timer_register(REPEAT_MS, scroll_repeat, p);
}
static void down_hold(ClickRecognizerRef ref, void *context) { hold_begin(context, SCROLLVIEW_DOWN); }
static void up_hold(ClickRecognizerRef ref, void *context)   { hold_begin(context, SCROLLVIEW_UP); }
static void hold_release(ClickRecognizerRef ref, void *context) {
  ((Pager *)context)->holding = false;                   // scroll_repeat sees this and stops
}
static void back_click(ClickRecognizerRef ref, void *context) {
  window_stack_pop(true);
}
static void pager_ccp(void *context) {
  window_single_click_subscribe(BUTTON_ID_DOWN, down_tap);
  window_long_click_subscribe(BUTTON_ID_DOWN, HOLD_MS, down_hold, hold_release);
  window_single_click_subscribe(BUTTON_ID_UP, up_tap);
  window_long_click_subscribe(BUTTON_ID_UP, HOLD_MS, up_hold, hold_release);
  window_single_click_subscribe(BUTTON_ID_BACK, back_click);
}

// --- window lifecycle --------------------------------------------------------
static void pager_load(Window *w) {
  Pager *p = window_get_user_data(w);
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  p->width = b.size.w;
  // Footer dots claim a band the content sits above; floating dots take no space
  // and just overlay the bottom of a full-height content area.
  bool floating = (p->dots_style == UI_DOTS_FLOATING);
  p->viewport_h = floating ? b.size.h : b.size.h - DOTS_BAND;

  // Content area: a scrollview with the caret affordance. Created first so the
  // dots band (added after) layers above it; they don't overlap regardless.
  p->sv = scrollview_create(root, GRect(0, 0, p->width, p->viewport_h),
                            SCROLLVIEW_CARETS, SCROLLVIEW_SPEED_MEDIUM);
  // Floating dots overlay the bottom of the full-height content, so reserve that
  // band as a scroll inset — pages bottom-anchor above it without knowing it's
  // there. Footer dots already have their own band (viewport_h above), inset 0.
  if (floating) scrollview_set_bottom_inset(p->sv, DOTS_BAND);

  p->dots = layer_create_with_data(
      GRect(0, b.size.h - DOTS_BAND, p->width, DOTS_BAND), sizeof(Pager *));
  *(Pager **)layer_get_data(p->dots) = p;
  layer_set_update_proc(p->dots, dots_update);
  layer_add_child(root, p->dots);

  window_set_click_config_provider_with_context(w, pager_ccp, p);
  show_page(p, 0, false);
}
static void pager_unload(Window *w) {
  Pager *p = window_get_user_data(w);
  if (p->timer) app_timer_cancel(p->timer);
  scrollview_destroy(p->sv);
  layer_destroy(p->dots);
  window_destroy(p->window);
  free(p->pages);
  free(p);
}

Pager *pager_push(const Page *pages, int n, UiDotsStyle dots) {
  if (n > PAGER_MAX) n = PAGER_MAX;
  Pager *p = malloc(sizeof(Pager));
  if (!p) return NULL;
  *p = (Pager){0};
  p->n = n;
  p->dots_style = dots;
  p->pages = malloc(sizeof(Page) * (n > 0 ? n : 1));
  if (!p->pages) { free(p); return NULL; }
  if (n > 0) memcpy(p->pages, pages, sizeof(Page) * n);

  p->window = window_create();
  window_set_background_color(p->window, ui_background());
  window_set_user_data(p->window, p);
  window_set_window_handlers(p->window, (WindowHandlers){
    .load = pager_load, .unload = pager_unload,
  });
  window_stack_push(p->window, true);
  return p;
}
