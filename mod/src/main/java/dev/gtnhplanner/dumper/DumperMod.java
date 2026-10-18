package dev.gtnhplanner.dumper;

import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.event.FMLServerStartingEvent;

/** Registers {@code /gtnhplanner dump}, which writes every GregTech recipe to a JSON file for the GTNH Planner. */
@Mod(
    modid = DumperMod.MODID,
    name = "GTNH Planner Recipe Dumper",
    version = Tags.VERSION,
    dependencies = "required-after:gregtech",
    acceptableRemoteVersions = "*")
public class DumperMod {

    public static final String MODID = "gtnhplannerdumper";

    @Mod.EventHandler
    public void serverStarting(FMLServerStartingEvent event) {
        event.registerServerCommand(new DumpCommand());
    }
}
