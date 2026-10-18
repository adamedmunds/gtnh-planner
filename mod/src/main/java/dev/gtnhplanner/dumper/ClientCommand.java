package dev.gtnhplanner.dumper;

import net.minecraft.client.Minecraft;
import net.minecraft.command.CommandBase;
import net.minecraft.command.ICommandSender;
import net.minecraftforge.client.ClientCommandHandler;

/**
 * Client side of {@code /gtnhplanner}: {@code icons} needs the game's renderer, so it runs here on the client thread;
 * anything else (e.g. {@code dump}) is passed on to the server command unchanged.
 */
public class ClientCommand extends CommandBase {

    static void register() {
        ClientCommandHandler.instance.registerCommand(new ClientCommand());
    }

    @Override
    public String getCommandName() {
        return "gtnhplanner";
    }

    @Override
    public String getCommandUsage(ICommandSender sender) {
        return "/gtnhplanner dump | icons";
    }

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
        if (args.length == 1 && "icons".equals(args[0])) {
            IconExporter.start(sender);
            return;
        }
        Minecraft.getMinecraft().thePlayer.sendChatMessage("/gtnhplanner " + String.join(" ", args));
    }
}
