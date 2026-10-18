package dev.gtnhplanner.dumper;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.GZIPInputStream;

import javax.imageio.ImageIO;

import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.entity.RenderItem;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.command.ICommandSender;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ChatComponentText;
import net.minecraft.util.EnumChatFormatting;
import net.minecraft.util.IIcon;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidRegistry;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;

/**
 * Renders the icon of every item, machine and fluid in the recipe dump with the game's own renderer (so tinted GT
 * materials, 3D blocks and overlays look exactly as in NEI) into 32x32 cells of 2048x2048 PNG sprite sheets, plus an
 * {@code icons.json} index keyed by the planner's resource keys. One sheet is drawn per frame.
 */
public final class IconExporter {

    private static final Logger LOG = LogManager.getLogger(DumperMod.MODID);
    static final int SIZE = 32, PER_ROW = 64, SHEET = SIZE * PER_ROW, PER_SHEET = PER_ROW * PER_ROW;

    private static IconExporter running;

    /** A thing to draw: an item stack or a fluid, under its planner resource key. */
    private static final class Entry {

        final String key;
        final ItemStack stack;
        final Fluid fluid;

        Entry(String key, ItemStack stack, Fluid fluid) {
            this.key = key;
            this.stack = stack;
            this.fluid = fluid;
        }
    }

    private final ICommandSender sender;
    private final File dir;
    private final List<Entry> entries;
    private final Map<String, int[]> index = new LinkedHashMap<>();
    private final List<String> sheets = new ArrayList<>();
    private final RenderItem renderItem = new RenderItem();
    private Framebuffer fb;
    private int next, failed;

    private IconExporter(ICommandSender sender, File dir, List<Entry> entries, int missing) {
        this.sender = sender;
        this.dir = dir;
        this.entries = entries;
        this.failed = missing;
    }

    static void start(ICommandSender sender) {
        if (running != null) {
            say(sender, EnumChatFormatting.YELLOW, "Already exporting icons...");
            return;
        }
        File base = new File(Minecraft.getMinecraft().mcDataDir, "gtnh-planner");
        File dump = new File(base, "recipes.json.gz");
        if (!dump.isFile()) {
            say(sender, EnumChatFormatting.RED, "Run /gtnhplanner dump first");
            return;
        }
        List<Entry> entries = new ArrayList<>();
        int missing;
        try {
            missing = readEntries(dump, entries);
        } catch (Exception e) {
            LOG.error("Could not read " + dump, e);
            say(sender, EnumChatFormatting.RED, "Could not read the recipe dump: " + e);
            return;
        }
        File dir = new File(base, "icons");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            say(sender, EnumChatFormatting.RED, "Could not create " + dir);
            return;
        }
        running = new IconExporter(sender, dir, entries, missing);
        FMLCommonHandler.instance()
            .bus()
            .register(running);
        say(
            sender,
            EnumChatFormatting.GRAY,
            "Rendering " + entries.size() + " icons (" + (entries.size() + PER_SHEET - 1) / PER_SHEET + " sheets)...");
    }

    /** Items, machine blocks and fluids from the dump, without duplicates. Returns how many could not be found. */
    private static int readEntries(File dump, List<Entry> out) throws Exception {
        JsonObject root;
        try (Reader r = new InputStreamReader(new GZIPInputStream(new FileInputStream(dump)), StandardCharsets.UTF_8)) {
            root = new JsonParser().parse(r)
                .getAsJsonObject();
        }
        Set<String> seen = new LinkedHashSet<>();
        int missing = 0;
        for (JsonElement el : root.getAsJsonArray("items")) {
            JsonObject it = el.getAsJsonObject();
            String id = it.get("id")
                .getAsString();
            int meta = it.get("meta")
                .getAsInt();
            if (!addItem(out, seen, id, meta)) missing++;
        }
        JsonArray machines = root.getAsJsonArray("machines");
        if (machines != null) for (JsonElement el : machines) {
            int mID = el.getAsJsonObject()
                .get("mID")
                .getAsInt();
            if (!addItem(out, seen, "gregtech:gt.blockmachines", mID)) missing++;
        }
        for (JsonElement el : root.getAsJsonArray("fluids")) {
            String id = el.getAsJsonObject()
                .get("id")
                .getAsString();
            String key = "fluid:" + id;
            if (!seen.add(key)) continue;
            Fluid f = FluidRegistry.getFluid(id);
            if (f == null) missing++;
            else out.add(new Entry(key, null, f));
        }
        return missing;
    }

    private static boolean addItem(List<Entry> out, Set<String> seen, String id, int meta) {
        String key = "item:" + id + "@" + meta;
        if (!seen.add(key)) return true;
        Object item = Item.itemRegistry.getObject(id);
        if (!(item instanceof Item)) return false;
        // Wildcard ("any variant") inputs draw as their base variant.
        out.add(new Entry(key, new ItemStack((Item) item, 1, meta == 32767 ? 0 : meta), null));
        return true;
    }

    @SubscribeEvent
    public void onRenderTick(TickEvent.RenderTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        try {
            renderSheet();
            if (next >= entries.size()) finish(null);
            else say(sender, EnumChatFormatting.GRAY, "Sheet " + sheets.size() + " done...");
        } catch (Exception e) {
            LOG.error("Icon export failed", e);
            finish(e);
        }
    }

    private void renderSheet() throws Exception {
        Minecraft mc = Minecraft.getMinecraft();
        if (fb == null) fb = new Framebuffer(SHEET, SHEET, true);
        fb.setFramebufferColor(0f, 0f, 0f, 0f);
        fb.framebufferClear();
        fb.bindFramebuffer(true);

        GL11.glMatrixMode(GL11.GL_PROJECTION);
        GL11.glPushMatrix();
        GL11.glLoadIdentity();
        GL11.glOrtho(0, SHEET, SHEET, 0, 1000, 3000);
        GL11.glMatrixMode(GL11.GL_MODELVIEW);
        GL11.glPushMatrix();
        GL11.glLoadIdentity();
        GL11.glTranslatef(0, 0, -2000);
        GL11.glEnable(GL11.GL_DEPTH_TEST);
        GL11.glEnable(GL12.GL_RESCALE_NORMAL);
        GL11.glEnable(GL11.GL_BLEND);
        GL11.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA);

        int sheet = sheets.size();
        for (int cell = 0; cell < PER_SHEET && next < entries.size(); next++) {
            Entry e = entries.get(next);
            int col = cell % PER_ROW, row = cell / PER_ROW;
            GL11.glPushMatrix();
            try {
                GL11.glTranslatef(col * SIZE, row * SIZE, 0);
                GL11.glScalef(2f, 2f, 1f);
                if (e.stack != null) drawItem(mc, e.stack);
                else drawFluid(mc, e.fluid);
                index.put(e.key, new int[] { sheet, col, row });
                cell++;
            } catch (Throwable t) {
                failed++;
                LOG.warn("Could not draw " + e.key + ": " + t);
            } finally {
                GL11.glPopMatrix();
                GL11.glColor4f(1f, 1f, 1f, 1f);
            }
        }

        BufferedImage img = readPixels();
        GL11.glMatrixMode(GL11.GL_PROJECTION);
        GL11.glPopMatrix();
        GL11.glMatrixMode(GL11.GL_MODELVIEW);
        GL11.glPopMatrix();
        RenderHelper.disableStandardItemLighting();
        fb.unbindFramebuffer();
        mc.getFramebuffer()
            .bindFramebuffer(true);

        String name = "icons-" + sheet + ".png";
        ImageIO.write(img, "png", new File(dir, name));
        sheets.add(name);
    }

    private void drawItem(Minecraft mc, ItemStack stack) {
        RenderHelper.enableGUIStandardItemLighting();
        renderItem.zLevel = 0f;
        renderItem.renderItemAndEffectIntoGUI(mc.fontRenderer, mc.getTextureManager(), stack, 0, 0);
        RenderHelper.disableStandardItemLighting();
    }

    private void drawFluid(Minecraft mc, Fluid fluid) {
        IIcon icon = fluid.getStillIcon();
        if (icon == null) icon = fluid.getIcon();
        if (icon == null) throw new IllegalStateException("no icon");
        mc.getTextureManager()
            .bindTexture(TextureMap.locationBlocksTexture);
        int c = fluid.getColor();
        GL11.glDisable(GL11.GL_LIGHTING);
        GL11.glColor4f(((c >> 16) & 255) / 255f, ((c >> 8) & 255) / 255f, (c & 255) / 255f, 1f);
        Tessellator t = Tessellator.instance;
        t.startDrawingQuads();
        t.addVertexWithUV(0, 16, 0, icon.getMinU(), icon.getMaxV());
        t.addVertexWithUV(16, 16, 0, icon.getMaxU(), icon.getMaxV());
        t.addVertexWithUV(16, 0, 0, icon.getMaxU(), icon.getMinV());
        t.addVertexWithUV(0, 0, 0, icon.getMinU(), icon.getMinV());
        t.draw();
    }

    /** The bound framebuffer as an image (OpenGL rows run bottom-up). */
    private static BufferedImage readPixels() {
        ByteBuffer buf = BufferUtils.createByteBuffer(SHEET * SHEET * 4);
        GL11.glReadPixels(0, 0, SHEET, SHEET, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buf);
        BufferedImage img = new BufferedImage(SHEET, SHEET, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < SHEET; y++) {
            for (int x = 0; x < SHEET; x++) {
                int i = (x + (SHEET - 1 - y) * SHEET) * 4;
                int r = buf.get(i) & 255, g = buf.get(i + 1) & 255, b = buf.get(i + 2) & 255, a = buf.get(i + 3) & 255;
                img.setRGB(x, y, (a << 24) | (r << 16) | (g << 8) | b);
            }
        }
        return img;
    }

    private void finish(Exception error) {
        FMLCommonHandler.instance()
            .bus()
            .unregister(this);
        running = null;
        if (fb != null) fb.deleteFramebuffer();
        if (error != null) {
            say(sender, EnumChatFormatting.RED, "Icon export failed: " + error + " (see log)");
            return;
        }
        File out = new File(dir, "icons.json");
        try (Writer w = new OutputStreamWriter(new FileOutputStream(out), StandardCharsets.UTF_8);
            JsonWriter j = new JsonWriter(w)) {
            j.beginObject();
            j.name("format")
                .value(1);
            j.name("size")
                .value(SIZE);
            j.name("perRow")
                .value(PER_ROW);
            j.name("sheets")
                .beginArray();
            for (String s : sheets) j.value(s);
            j.endArray();
            j.name("icons")
                .beginObject();
            for (Map.Entry<String, int[]> e : index.entrySet()) {
                j.name(e.getKey())
                    .beginArray()
                    .value(e.getValue()[0])
                    .value(e.getValue()[1])
                    .value(e.getValue()[2])
                    .endArray();
            }
            j.endObject();
            j.endObject();
        } catch (Exception e) {
            LOG.error("Could not write " + out, e);
            say(sender, EnumChatFormatting.RED, "Could not write the icon index: " + e);
            return;
        }
        say(
            sender,
            EnumChatFormatting.GREEN,
            "Saved " + index.size() + " icons (" + failed + " failed) to " + dir.getAbsolutePath());
    }

    private static void say(ICommandSender sender, EnumChatFormatting color, String text) {
        ChatComponentText msg = new ChatComponentText(text);
        msg.getChatStyle()
            .setColor(color);
        sender.addChatMessage(msg);
    }
}
