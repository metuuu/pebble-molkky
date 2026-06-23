#include "scrollview.h"
#include "scroll_hint.h"
#include "ui_theme.h"

#define BAR_W      3     // scrollbar thumb width
#define BAR_MIN    16    // shortest the thumb gets
#define REPEAT_MS  100   // held-button repeat interval — fixed, so speed is constant

struct Scrollview {
  Layer               *content;   // draws the content, shifted up by scroll_y
  Layer               *bar;       // scrollbar overlay (drawn only in SCROLLBAR mode)
  ScrollHint          *hint;      // caret overlay (active only in CARETS mode)
  ScrollviewContent    c;
  ScrollviewAffordance affordance;
  ScrollviewSpeed      speed;
  int                  width, height;   // viewport (the frame we were created in)
  int                  bottom_inset;    // reserved strip at the viewport bottom
  int                  content_h;       // resolved from c.measure / c.content_h
  int                  scroll_y;        // 0..max_off
};

// Height available to lay out and scroll content in: the viewport minus the
// reserved bottom strip (see scrollview_set_bottom_inset).
static int usable_h(Scrollview *s) { return s->height - s->bottom_inset; }

static int max_off(Scrollview *s) {
  int m = s->content_h - usable_h(s);
  return m > 0 ? m : 0;
}
// Pixels per repeat tick. The interval is fixed (REPEAT_MS), so a bigger step is
// simply a faster constant scroll — no acceleration, the distance never ramps.
static int step(Scrollview *s) {
  switch (s->speed) {
    case SCROLLVIEW_SPEED_SLOW: return 12;
    case SCROLLVIEW_SPEED_FAST: return 44;
    default:                    return 26;   // SCROLLVIEW_SPEED_MEDIUM
  }
}

// --- drawing -----------------------------------------------------------------
static void content_update(Layer *l, GContext *ctx) {
  Scrollview *s = *(Scrollview **)layer_get_data(l);
  GRect b = layer_get_bounds(l);
  if (s->c.draw) {
    // A page shorter than the usable area gets the full usable height to lay out
    // in (so it can center/bottom-align/fill above any reserved bottom strip); a
    // taller page gets its content height and scrolls. max_off keys off the same.
    int uh = usable_h(s);
    int draw_h = s->content_h < uh ? uh : s->content_h;
    s->c.draw(ctx, GRect(b.origin.x, b.origin.y - s->scroll_y, b.size.w, draw_h), s->c.data);
  }
}
static void bar_update(Layer *l, GContext *ctx) {
  Scrollview *s = *(Scrollview **)layer_get_data(l);
  if (s->affordance != SCROLLVIEW_SCROLLBAR) return;
  int vp = usable_h(s), ch = s->content_h, mo = ch - vp;
  if (mo <= 0) return;                                 // nothing to scroll
  int th = vp * vp / ch; if (th < BAR_MIN) th = BAR_MIN;
  int ty = (s->scroll_y * (vp - th)) / mo;
  graphics_context_set_fill_color(ctx, ui_text_muted());
  graphics_fill_rect(ctx, GRect(s->width - BAR_W, ty, BAR_W, th), 1, GCornersAll);
}

// --- state -------------------------------------------------------------------
// A caret shows purely by scroll position: down while there's room below, up
// while there's room above. It hides at each edge — anything beyond (a page to
// turn to, say) is the host's affordance to show, not the scrollview's.
static void refresh_affordance(Scrollview *s) {
  bool caret = s->affordance == SCROLLVIEW_CARETS;
  scroll_hint_set(s->hint, (ScrollHintModel){
    .down = caret && s->scroll_y < max_off(s),
    .up   = caret && s->scroll_y > 0,
  });
  layer_mark_dirty(s->bar);
}
static void scroll_to(Scrollview *s, int y) {
  if (y < 0) y = 0; else if (y > max_off(s)) y = max_off(s);
  s->scroll_y = y;
  layer_mark_dirty(s->content);
  refresh_affordance(s);
}

// --- public: embeddable ------------------------------------------------------
Scrollview *scrollview_create(Layer *parent, GRect frame,
                              ScrollviewAffordance affordance, ScrollviewSpeed speed) {
  Scrollview *s = malloc(sizeof(Scrollview));
  if (!s) return NULL;
  *s = (Scrollview){0};
  s->affordance = affordance;
  s->speed      = speed;
  s->width      = frame.size.w;
  s->height     = frame.size.h;

  s->content = layer_create_with_data(frame, sizeof(Scrollview *));
  *(Scrollview **)layer_get_data(s->content) = s;
  layer_set_update_proc(s->content, content_update);
  layer_add_child(parent, s->content);

  s->bar = layer_create_with_data(frame, sizeof(Scrollview *));
  *(Scrollview **)layer_get_data(s->bar) = s;
  layer_set_update_proc(s->bar, bar_update);
  layer_add_child(parent, s->bar);

  s->hint = scroll_hint_create(parent, frame);
  return s;
}

void scrollview_destroy(Scrollview *s) {
  if (!s) return;
  scroll_hint_destroy(s->hint);
  layer_destroy(s->bar);
  layer_destroy(s->content);
  free(s);
}

void scrollview_set_content(Scrollview *s, ScrollviewContent content, bool at_bottom) {
  if (!s) return;
  s->c = content;
  s->content_h = content.measure ? content.measure(s->width, content.data) : content.content_h;
  s->scroll_y = at_bottom ? max_off(s) : 0;
  layer_mark_dirty(s->content);
  refresh_affordance(s);
}

bool scrollview_scroll(Scrollview *s, ScrollviewDir dir) {
  if (!s) return false;
  int before = s->scroll_y;
  scroll_to(s, s->scroll_y + (dir == SCROLLVIEW_DOWN ? step(s) : -step(s)));
  return s->scroll_y != before;            // false → already at that edge
}

bool scrollview_at_top(const Scrollview *s)    { return !s || s->scroll_y <= 0; }
bool scrollview_at_bottom(const Scrollview *s) {
  return !s || s->scroll_y >= max_off((Scrollview *)s);
}

void scrollview_set_bottom_inset(Scrollview *s, int inset) {
  if (!s || inset == s->bottom_inset) return;
  s->bottom_inset = inset;
  scroll_to(s, s->scroll_y);     // re-clamp to the new max_off and redraw
}
void scrollview_set_affordance(Scrollview *s, ScrollviewAffordance a) {
  if (!s) return;
  s->affordance = a;
  refresh_affordance(s);
}
void scrollview_set_speed(Scrollview *s, ScrollviewSpeed speed) {
  if (s) s->speed = speed;     // read live by step(); no re-subscribe needed
}
ScrollviewAffordance scrollview_affordance(const Scrollview *s) { return s->affordance; }
ScrollviewSpeed      scrollview_speed(const Scrollview *s)      { return s->speed; }

// --- public: standalone window wrapper ---------------------------------------
// A thin host window that embeds one full-screen Scrollview and wires the buttons
// to it. Repeating Up/Down scroll; Select fires on_select; Back pops.
typedef struct {
  Window     *window;
  Scrollview *sv;
  ScrollviewOpts opts;
} SvHost;

static void host_down(ClickRecognizerRef ref, void *ctx) {
  scrollview_scroll(((SvHost *)ctx)->sv, SCROLLVIEW_DOWN);
}
static void host_up(ClickRecognizerRef ref, void *ctx) {
  scrollview_scroll(((SvHost *)ctx)->sv, SCROLLVIEW_UP);
}
static void host_select(ClickRecognizerRef ref, void *ctx) {
  SvHost *h = ctx;
  if (h->opts.on_select) h->opts.on_select(h->opts.content.data);
}
static void host_back(ClickRecognizerRef ref, void *ctx) { window_stack_pop(true); }
static void host_ccp(void *ctx) {
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, REPEAT_MS, host_down);
  window_single_repeating_click_subscribe(BUTTON_ID_UP, REPEAT_MS, host_up);
  window_single_click_subscribe(BUTTON_ID_SELECT, host_select);
  window_single_click_subscribe(BUTTON_ID_BACK, host_back);
}
static void host_load(Window *w) {
  SvHost *h = window_get_user_data(w);
  Layer *root = window_get_root_layer(w);
  h->sv = scrollview_create(root, layer_get_bounds(root), h->opts.affordance, h->opts.speed);
  scrollview_set_content(h->sv, h->opts.content, false);
  window_set_click_config_provider_with_context(w, host_ccp, h);
}
static void host_unload(Window *w) {
  SvHost *h = window_get_user_data(w);
  scrollview_destroy(h->sv);
  window_destroy(h->window);
  free(h);
}

Scrollview *scrollview_push(ScrollviewOpts opts) {
  SvHost *h = malloc(sizeof(SvHost));
  if (!h) return NULL;
  *h = (SvHost){0};
  h->opts = opts;
  h->window = window_create();
  window_set_background_color(h->window, ui_background());
  window_set_user_data(h->window, h);
  window_set_window_handlers(h->window, (WindowHandlers){ .load = host_load, .unload = host_unload });
  window_stack_push(h->window, true);   // load runs here, so h->sv is set on return
  return h->sv;
}
