import assert from "node:assert/strict";
import {
    DIRECTOR_PUBLIC_OUTPUTS,
    staleDirectorOutputIndices,
} from "../../web/js/minimax_director_outputs_core.mjs";

assert.deepEqual(
    DIRECTOR_PUBLIC_OUTPUTS,
    ["images", "audio", "fps"],
);

assert.deepEqual(
    staleDirectorOutputIndices([
        { name: "images" },
        { name: "audio" },
        { name: "fps" },
        { name: "frame_count" },
        { name: "source_images" },
        { name: "report" },
    ]),
    [5, 4, 3],
);

assert.deepEqual(
    staleDirectorOutputIndices([
        { name: "images" },
        { name: "audio" },
        { name: "fps" },
    ]),
    [],
);

console.log("director outputs core: PASS");
