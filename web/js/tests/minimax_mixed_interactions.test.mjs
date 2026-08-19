import assert from 'node:assert/strict';
import {
  autoScrollDelta,
  selectedIdsFromTimeline,
  selectionIndicesForIds,
  toggleSelectedId,
  moveSegmentById,
  preserveExplicitEmptyRunSelection,
} from '../minimax_mixed_interactions.mjs';

const segments = Array.from({length: 20}, (_, i) => ({id: `seg_${i + 1}`}));
const state = {runSelectEnabled: true, runSelection: [4, 17], segments};
assert.deepEqual([...selectedIdsFromTimeline(state)], ['seg_5', 'seg_18']);
assert.deepEqual(selectionIndicesForIds(segments, new Set()), [], 'entering Selective Run starts with nothing selected');
assert.deepEqual([...selectedIdsFromTimeline({runSelectEnabled: false, runSelection: [0], segments})], []);

let ids = new Set();
ids = toggleSelectedId(ids, 'seg_18', true);
assert.deepEqual([...ids], ['seg_18']);
ids = toggleSelectedId(ids, 'seg_5', true);
assert.deepEqual([...ids], ['seg_18', 'seg_5']);
ids = toggleSelectedId(ids, 'seg_18', false);
assert.deepEqual([...ids], ['seg_5']);

const moved = moveSegmentById(segments, 'seg_18', 2);
assert.equal(moved[2].id, 'seg_18', 'old Segment 18 becomes display position 3');
assert.equal(moved[3].id, 'seg_3');
assert.equal(moved[17].id, 'seg_17');
assert.deepEqual(selectionIndicesForIds(moved, new Set(['seg_18', 'seg_5'])), [2, 5]);

assert.equal(autoScrollDelta(5, {left: 0, right: 500}), -32);
assert.equal(autoScrollDelta(495, {left: 0, right: 500}), 32);
assert.equal(autoScrollDelta(250, {left: 0, right: 500}), 0);

const migrated = preserveExplicitEmptyRunSelection(
  {timelineMode: 'mixed', runSelectEnabled: true, runSelection: []},
  {timelineMode: 'mixed', runSelectEnabled: true, runSelection: [0, 1, 2]},
);
assert.deepEqual(migrated.runSelection, [], 'reload must preserve an explicitly empty Selective Run selection');
assert.deepEqual(
  preserveExplicitEmptyRunSelection(
    {timelineMode: 'mixed', runSelectEnabled: true},
    {timelineMode: 'mixed', runSelectEnabled: true, runSelection: [0, 1]},
  ).runSelection,
  [0, 1],
  'legacy state without runSelection keeps its existing migration behavior',
);

console.log('mixed interaction tests passed');
