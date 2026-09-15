import assert from "node:assert/strict";
import fs from "node:fs";
import {
    materialCategories,
    materialCategoryLabel,
} from "../minimax_material_library_i18n.mjs?boot=material_library_i18n_v2";
import { setLocale } from "../minimax_i18n.js?boot=director_i18n_v2";

const modalSrc = fs.readFileSync(new URL("../minimax_material_library_modal.mjs", import.meta.url), "utf8");
assert.match(modalSrc, /appendSubtab\(category, materialCategoryLabel\(category\)\)/);
assert.match(modalSrc, /materialCategoryLabel\(item\.category \|\| "其他"\)/);
assert.match(modalSrc, /o\.textContent = materialCategoryLabel\(value\)/);

setLocale("en");
assert.deepEqual(materialCategories("image"), ["人物", "场景", "道具", "其他"]);
assert.equal(materialCategoryLabel("人物"), "Characters");
assert.equal(materialCategoryLabel("场景"), "Scenes");
assert.equal(materialCategoryLabel("道具"), "Props");
assert.equal(materialCategoryLabel("其他"), "Other");
assert.equal(materialCategoryLabel("Custom"), "Custom");

setLocale("zh");
assert.equal(materialCategoryLabel("人物"), "人物");
console.log("material library i18n test passed");
