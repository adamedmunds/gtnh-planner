package dev.gtnhplanner.dumper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.StatCollector;
import net.minecraftforge.fluids.FluidStack;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.Loader;
import cpw.mods.fml.common.ModContainer;
import gregtech.api.GregTechAPI;
import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.interfaces.tileentity.RecipeMapWorkable;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import gregtech.api.metatileentity.implementations.MTETieredMachineBlock;
import gregtech.api.recipe.RecipeMap;
import gregtech.api.util.GTRecipe;

/**
 * Streams every visible GregTech recipe to gzipped JSON. Items, fluids and recipe maps are written once in lookup
 * tables and referenced from recipes by index, which keeps the file small.
 *
 * <pre>
 * {
 *   "format": 1, "gregtech": "5.09.54.183",
 *   "recipes":    [{ "m": mapIdx, "eut": 30, "dur": 20, "sv": 0,
 *                    "ii": [[itemIdx, count]], "fi": [[fluidIdx, amount]],
 *                    "io": [[itemIdx, count, chance/10000]], "fo": [[fluidIdx, amount]] }],
 *   "recipeMaps": [{ "id": "gt.recipe.distillery", "name": "Distillery", "amperage": 1 }],
 *   "machines":   [{ "mID": 531, "name": "Basic Distillery", "tier": 1, "maps": [mapIdx] }],
 *   "items":      [{ "id": "gregtech:gt.metaitem.01", "meta": 2032, "name": "Tin Dust" }],
 *   "fluids":     [{ "id": "oil", "name": "Oil" }]
 * }
 * </pre>
 *
 * Item input count 0 means "not consumed" (programmed circuits, molds). Output chance is out of 10000.
 */
public class RecipeDumper {

    private static final Logger LOG = LogManager.getLogger(DumperMod.MODID);
    public static final int FORMAT = 1;

    public static class Summary {

        public int recipes, recipeMaps, machines, items, fluids, skippedRecipes;
    }

    private final Map<String, Integer> itemIndex = new LinkedHashMap<>();
    private final List<String[]> items = new ArrayList<>(); // id, meta, name
    private final Map<String, Integer> fluidIndex = new LinkedHashMap<>();
    private final List<String[]> fluids = new ArrayList<>(); // id, name
    private final Map<RecipeMap<?>, Integer> mapIndex = new LinkedHashMap<>();

    public Summary dump(File out) throws IOException {
        File dir = out.getParentFile();
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create " + dir);

        Summary summary = new Summary();
        List<RecipeMap<?>> maps = new ArrayList<>(RecipeMap.ALL_RECIPE_MAPS.values());
        maps.sort((a, b) -> a.unlocalizedName.compareTo(b.unlocalizedName));
        for (RecipeMap<?> map : maps) mapIndex.put(map, mapIndex.size());

        File tmp = new File(dir, out.getName() + ".tmp");
        try (JsonWriter w = new JsonWriter(
            new OutputStreamWriter(new GZIPOutputStream(new FileOutputStream(tmp)), StandardCharsets.UTF_8))) {
            w.beginObject();
            w.name("format")
                .value(FORMAT);
            w.name("gregtech")
                .value(modVersion("gregtech"));
            w.name("exportedAt")
                .value(System.currentTimeMillis());

            w.name("recipes")
                .beginArray();
            for (RecipeMap<?> map : maps) {
                int m = mapIndex.get(map);
                for (GTRecipe r : safeRecipes(map)) {
                    if (r.mHidden || r.mFakeRecipe || !r.mEnabled) continue;
                    try {
                        writeRecipe(w, m, r);
                        summary.recipes++;
                    } catch (RuntimeException e) {
                        summary.skippedRecipes++;
                        LOG.warn("Skipping unreadable recipe in {}: {}", map.unlocalizedName, e.toString());
                    }
                }
            }
            w.endArray();

            w.name("recipeMaps")
                .beginArray();
            for (RecipeMap<?> map : maps) {
                w.beginObject();
                w.name("id")
                    .value(map.unlocalizedName);
                w.name("name")
                    .value(StatCollector.translateToLocal(map.unlocalizedName));
                w.name("amperage")
                    .value(map.getAmperage());
                w.endObject();
            }
            w.endArray();
            summary.recipeMaps = maps.size();

            w.name("machines")
                .beginArray();
            summary.machines = writeMachines(w);
            w.endArray();

            w.name("items")
                .beginArray();
            for (String[] it : items) {
                w.beginObject();
                w.name("id")
                    .value(it[0]);
                w.name("meta")
                    .value(Integer.parseInt(it[1]));
                w.name("name")
                    .value(it[2]);
                w.endObject();
            }
            w.endArray();
            summary.items = items.size();

            w.name("fluids")
                .beginArray();
            for (String[] fl : fluids) {
                w.beginObject();
                w.name("id")
                    .value(fl[0]);
                w.name("name")
                    .value(fl[1]);
                w.endObject();
            }
            w.endArray();
            summary.fluids = fluids.size();

            w.endObject();
        }
        if (out.exists() && !out.delete()) throw new IOException("Cannot replace " + out);
        if (!tmp.renameTo(out)) throw new IOException("Cannot rename " + tmp + " to " + out);
        return summary;
    }

    private static Collection<GTRecipe> safeRecipes(RecipeMap<?> map) {
        try {
            return map.getAllRecipes();
        } catch (RuntimeException e) {
            LOG.warn("Cannot read recipe map {}: {}", map.unlocalizedName, e.toString());
            return Collections.emptyList();
        }
    }

    private void writeRecipe(JsonWriter w, int m, GTRecipe r) throws IOException {
        w.beginObject();
        w.name("m")
            .value(m);
        w.name("eut")
            .value(r.mEUt);
        w.name("dur")
            .value(r.mDuration);
        if (r.mSpecialValue != 0) w.name("sv")
            .value(r.mSpecialValue);

        if (r.mInputs != null && r.mInputs.length > 0) {
            w.name("ii")
                .beginArray();
            for (ItemStack s : r.mInputs) {
                if (s == null || s.getItem() == null) continue;
                w.beginArray()
                    .value(item(s))
                    .value(s.stackSize)
                    .endArray();
            }
            w.endArray();
        }
        if (r.mFluidInputs != null && r.mFluidInputs.length > 0) {
            w.name("fi")
                .beginArray();
            for (FluidStack f : r.mFluidInputs) {
                if (f == null || f.getFluid() == null) continue;
                w.beginArray()
                    .value(fluid(f))
                    .value(f.amount)
                    .endArray();
            }
            w.endArray();
        }
        if (r.mOutputs != null && r.mOutputs.length > 0) {
            w.name("io")
                .beginArray();
            for (int i = 0; i < r.mOutputs.length; i++) {
                ItemStack s = r.mOutputs[i];
                if (s == null || s.getItem() == null) continue;
                w.beginArray()
                    .value(item(s))
                    .value(s.stackSize)
                    .value(r.getOutputChance(i))
                    .endArray();
            }
            w.endArray();
        }
        if (r.mFluidOutputs != null && r.mFluidOutputs.length > 0) {
            w.name("fo")
                .beginArray();
            for (FluidStack f : r.mFluidOutputs) {
                if (f == null || f.getFluid() == null) continue;
                w.beginArray()
                    .value(fluid(f))
                    .value(f.amount)
                    .endArray();
            }
            w.endArray();
        }
        w.endObject();
    }

    private int item(ItemStack s) {
        String id = String.valueOf(Item.itemRegistry.getNameForObject(s.getItem()));
        int meta = s.getItemDamage();
        String key = id + "@" + meta;
        Integer idx = itemIndex.get(key);
        if (idx != null) return idx;
        String name;
        try {
            name = s.getDisplayName();
        } catch (RuntimeException e) {
            name = s.getUnlocalizedName();
        }
        idx = items.size();
        items.add(new String[] { id, String.valueOf(meta), name });
        itemIndex.put(key, idx);
        return idx;
    }

    private int fluid(FluidStack f) {
        String id = f.getFluid()
            .getName();
        Integer idx = fluidIndex.get(id);
        if (idx != null) return idx;
        String name;
        try {
            name = f.getLocalizedName();
        } catch (RuntimeException e) {
            name = id;
        }
        idx = fluids.size();
        fluids.add(new String[] { id, name });
        fluidIndex.put(id, idx);
        return idx;
    }

    /** Every GregTech machine (mID) that can run at least one recipe map, with its tier and maps. */
    private int writeMachines(JsonWriter w) throws IOException {
        int count = 0;
        IMetaTileEntity[] all = GregTechAPI.METATILEENTITIES;
        for (int id = 0; id < all.length; id++) {
            IMetaTileEntity mte = all[id];
            if (mte == null) continue;
            List<Integer> maps = new ArrayList<>();
            try {
                Collection<RecipeMap<?>> available;
                if (mte instanceof RecipeMapWorkable) {
                    available = ((RecipeMapWorkable) mte).getAvailableRecipeMaps();
                } else if (mte instanceof MTEMultiBlockBase) {
                    RecipeMap<?> single = ((MTEMultiBlockBase) mte).getRecipeMap();
                    available = single == null ? Collections.emptyList() : Collections.singletonList(single);
                } else {
                    continue;
                }
                for (RecipeMap<?> map : available) {
                    Integer idx = mapIndex.get(map);
                    if (idx != null && !maps.contains(idx)) maps.add(idx);
                }
            } catch (RuntimeException e) {
                LOG.warn("Cannot read recipe maps of machine {}: {}", id, e.toString());
                continue;
            }
            if (maps.isEmpty()) continue;

            String name;
            try {
                name = mte.getLocalName();
            } catch (RuntimeException e) {
                name = mte.getMetaName();
            }
            w.beginObject();
            w.name("mID")
                .value(id);
            w.name("name")
                .value(name);
            if (mte instanceof MTETieredMachineBlock) w.name("tier")
                .value(((MTETieredMachineBlock) mte).mTier);
            w.name("multiblock")
                .value(mte instanceof MTEMultiBlockBase);
            w.name("maps")
                .beginArray();
            for (int idx : maps) w.value(idx);
            w.endArray();
            w.endObject();
            count++;
        }
        return count;
    }

    private static String modVersion(String modId) {
        ModContainer mod = Loader.instance()
            .getIndexedModList()
            .get(modId);
        return mod == null ? "unknown" : mod.getVersion();
    }
}
