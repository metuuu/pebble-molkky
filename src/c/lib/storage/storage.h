#pragma once
#include <pebble.h>

// =============================================================================
// storage — a generic, record-agnostic synced store for the 4 KB-persist watch.
//
// The watch is an L1 *cache + write buffer*, not the system of record. The phone
// (PebbleKit JS + localStorage) holds the full archive. This is what dissolves
// the persist budget: the watch only keeps a bounded window of the newest
// records, however large the history grows.
//
// Model
//   * Every appended record gets a monotonic uint32 `seq` (starts at 1, never
//     reused). `seq` is the primary key on both sides.
//   * The newest `cache_capacity` records live on the watch (RAM mirror +
//     one persist value per slot) and are browsable offline (page 0).
//   * `acked_seq` is the highest seq the phone has confirmed storing. Records
//     with seq > acked_seq are "unsynced". The cache never evicts an unsynced
//     record; if it fills entirely with them the store goes BLOCKED.
//
// Paging
//   Navigation is *sync-then-fetch*: storage_load_page() first pushes any
//   unsynced records (and waits for the ACK), so by the time it queries the
//   phone the archive is complete and a page is a pure offset query — no
//   stitching between watch-only and phone-only records. Only the current page
//   lives in RAM. Requires the phone; page 0 has an offline fast-path via the
//   cache (storage_cache_*).
//
// The store owns the app's single AppMessage channel and the `st_*` keys
// (declared in package.json). Records are opaque bytes here; only the owning app
// interprets them, decoupling the JS side from the C struct layout.
// =============================================================================

// The largest record the store can persist: a slot carries a 4-byte seq header
// and a persist value is capped at 256 bytes, so record_size + 4 <= 256. This is
// a hardware limit; the cache *depth* has no fixed ceiling (see arena below).
#define STORAGE_REC_MAX 252

// Backing memory (bytes) the store needs for `cap` records of `rec` bytes each.
// The library keeps no static cache of its own — the caller provisions this buffer
// via StorageConfig.arena, so each app pays only for the window it keeps. The
// arena is carved into the seq table, the RAM cache mirror, and the page/tx
// scratch; the aligned regions assume a 4-byte-aligned arena.
#define STORAGE_ALIGN4(n) (((size_t)(n) + 3u) & ~(size_t)3u)
#define STORAGE_ARENA_BYTES(rec, cap)                 \
  ( STORAGE_ALIGN4((size_t)(cap) * sizeof(uint32_t))  \
  + STORAGE_ALIGN4((size_t)(cap) * (size_t)(rec))     \
  + STORAGE_ALIGN4((size_t)(cap) * (size_t)(rec))     \
  + (size_t)(cap) * ((size_t)(rec) + 4u) )

typedef enum {
  STORAGE_SYNCED,    // everything is backed up to the phone
  STORAGE_PENDING,   // unsynced records exist (will push when the phone is near)
  STORAGE_BLOCKED,   // cache full of unsynced records — must sync before adding more
} StorageSyncState;

typedef struct StorageConfig {
  uint16_t record_size;     // bytes per record (1 .. STORAGE_REC_MAX). Use a multiple
                            // of 4 if you read records back through a struct pointer
                            // (sizeof a word-aligned struct already is) so slots stay aligned.
  uint8_t  cache_capacity;  // recent records kept on-watch (>= 1; bounded only by the
                            // arena — clamped down to whatever `arena` can back).
  uint8_t  schema;          // app record schema/version, forwarded to the phone
  uint16_t base_key;        // first persist key the store owns; uses
                            //   base_key + 0                  (header)
                            //   base_key + 1 .. + cache_capacity (slots)

  // Caller-owned backing memory for the RAM cache and send/page scratch, carved by
  // the store. Provide a 4-byte-aligned buffer of at least
  // STORAGE_ARENA_BYTES(record_size, cache_capacity) that outlives the store
  // (typically a static array). cache_capacity is clamped down to what `arena` can
  // back, so the two always agree.
  void  *arena;
  size_t arena_size;

  // ---- async callbacks (always fire on the app's main loop) ----
  // A requested page arrived. `recs` points to `count` contiguous records
  // (record_size bytes each), newest-first; `offset` is the global index of the
  // first record (0 = newest); `total` is the phone's archive size. The pointer
  // is valid only during the call. count == 0 means the fetch failed.
  void (*on_page)(void *ctx, const void *recs, uint8_t count, uint32_t offset, uint32_t total);
  // The sync state / unsynced count changed. `total` is the best-known phone
  // archive size (0 until the first successful sync).
  void (*on_state)(void *ctx, StorageSyncState state, uint16_t unsynced, uint32_t total);
  void *ctx;
} StorageConfig;

// Load persisted state and open the AppMessage channel. Call once at startup.
// A best-effort sync is attempted immediately and on every phone (re)connect.
void storage_open(const StorageConfig *cfg);

// Append a record (copies record_size bytes, assigns the next seq). Returns the
// assigned seq, or 0 when BLOCKED (the caller must require a sync first).
uint32_t storage_append(const void *record);

// ---- watch cache (newest records, available offline → page 0) ----
uint8_t     storage_cache_count(void);
const void *storage_cache_get(uint8_t i);   // 0 = newest; NULL if out of range

// ---- sync ----
StorageSyncState storage_state(void);
uint16_t         storage_unsynced(void);
uint32_t         storage_total(void);       // best-known phone archive size (0 = unknown)
bool             storage_connected(void);   // phone app reachable right now
void             storage_sync_now(void);    // push unsynced if connected (else no-op)

// ---- paging from the phone (sync-then-fetch) ----
// Fetch page `page_index` of `page_size` records (newest-first), syncing first.
// Result arrives via on_page. Returns false if the phone is unreachable or a
// request is already in flight.
bool storage_load_page(uint32_t page_index, uint8_t page_size);
