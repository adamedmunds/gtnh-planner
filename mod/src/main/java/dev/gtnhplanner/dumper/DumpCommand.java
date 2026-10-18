package dev.gtnhplanner.dumper;

import java.io.File;

import net.minecraft.command.CommandBase;
import net.minecraft.command.ICommandSender;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.ChatComponentText;
import net.minecraft.util.EnumChatFormatting;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

public class DumpCommand extends CommandBase {

    private static final Logger LOG = LogManager.getLogger(DumperMod.MODID);

    @Override
    public String getCommandName() {
        return "gtnhplanner";
    }

    @Override
    public String getCommandUsage(ICommandSender sender) {
        return "/gtnhplanner dump";
    }

    /** Read-only export, so anyone in single-player may run it (cheats need not be on). */
    @Override
    public int getRequiredPermissionLevel() {
        return 0;
    }

    @Override
    public boolean canCommandSenderUseCommand(ICommandSender sender) {
        return true;
    }

    @Override
    public void processCommand(ICommandSender sender, String[] args) {
        if (args.length != 1 || !"dump".equals(args[0])) {
            say(sender, EnumChatFormatting.YELLOW, "Usage: " + getCommandUsage(sender));
            return;
        }
        File out = new File(
            MinecraftServer.getServer()
                .getFile("gtnh-planner"),
            "recipes.json.gz");
        say(sender, EnumChatFormatting.GRAY, "Dumping GregTech recipes...");
        long start = System.currentTimeMillis();
        try {
            RecipeDumper.Summary s = new RecipeDumper().dump(out);
            say(
                sender,
                EnumChatFormatting.GREEN,
                String.format(
                    "Dumped %d recipes in %d maps, %d machines, %d items, %d fluids, %d containers in %.1fs",
                    s.recipes,
                    s.recipeMaps,
                    s.machines,
                    s.items,
                    s.fluids,
                    s.containers,
                    (System.currentTimeMillis() - start) / 1000.0));
            say(sender, EnumChatFormatting.GREEN, "Saved to " + out.getAbsolutePath());
            if (s.skippedRecipes > 0) {
                say(sender, EnumChatFormatting.YELLOW, s.skippedRecipes + " recipes could not be read (see log)");
            }
        } catch (Exception e) {
            LOG.error("Recipe dump failed", e);
            say(sender, EnumChatFormatting.RED, "Dump failed: " + e + " (see log)");
        }
    }

    private static void say(ICommandSender sender, EnumChatFormatting color, String text) {
        ChatComponentText msg = new ChatComponentText(text);
        msg.getChatStyle()
            .setColor(color);
        sender.addChatMessage(msg);
    }
}
