package dev.gtnhplanner.dumper;

import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.event.FMLInitializationEvent;
import cpw.mods.fml.common.event.FMLServerStartingEvent;

/**
 * Registers {@code /gtnhplanner dump}, which writes every GregTech recipe to a JSON file for the GTNH Planner, and on
 * the client {@code /gtnhplanner icons}, which renders their icons.
 */
@Mod(
    modid = DumperMod.MODID,
    name = "GTNH Planner Recipe Dumper",
    version = Tags.VERSION,
    dependencies = "required-after:gregtech",
    acceptableRemoteVersions = "*")
public class DumperMod {

    public static final String MODID = "gtnhplannerdumper";

    @Mod.EventHandler
    public void init(FMLInitializationEvent event) {
        // ClientCommand touches client-only classes, so it is only loaded on the client.
        if (event.getSide()
            .isClient()) ClientCommand.register();
    }

    @Mod.EventHandler
    public void serverStarting(FMLServerStartingEvent event) {
        event.registerServerCommand(new DumpCommand());
    }
}
