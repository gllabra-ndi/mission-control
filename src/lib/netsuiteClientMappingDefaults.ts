/**
 * Canonical NetSuite project mappings for Mission Control clients.
 * Used to backfill ClientDirectory.netsuiteProjectId / netsuiteProjectName when empty
 * so Client Setup, capacity planning, and NetSuite time-entry sync stay aligned.
 *
 * Source: office NetSuite mapping table (Mission Control client → NetSuite project).
 * Intentionally excludes clients with no NetSuite project (e.g. Clairio).
 */

export type NetSuiteClientMappingDefault = {
    netsuiteProjectId: string;
    netsuiteProjectName: string;
};

export function normalizeNetSuiteClientDirectoryName(name: string): string {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

type MappingSeed = {
    /** Primary label as shown in Mission Control */
    name: string;
    /** Optional aliases (alternate spellings / spacing) */
    aliases?: string[];
    mapping: NetSuiteClientMappingDefault;
};

const NETSUITE_CLIENT_MAPPING_SEED: MappingSeed[] = [
    {
        name: "A2A",
        mapping: {
            netsuiteProjectId: "325864",
            netsuiteProjectName: "CyberActa : PROJ126 CyberActa : A2A - 25 hrs/week + Projects",
        },
    },
    {
        name: "AKRikks",
        mapping: {
            netsuiteProjectId: "165454",
            netsuiteProjectName: "A.K. Rikk's Inc. : A.K. Rikks",
        },
    },
    {
        name: "BigBolt",
        mapping: {
            netsuiteProjectId: "204987",
            netsuiteProjectName: "Big Bolt LLC : Big Bolt Dynamic Services - T&M",
        },
    },
    {
        name: "Centium/A3B",
        mapping: {
            netsuiteProjectId: "355269",
            netsuiteProjectName: "Centium Consulting Inc. : Centium A3B Implementation",
        },
    },
    {
        name: "Centium/C3CW",
        mapping: {
            netsuiteProjectId: "349330",
            netsuiteProjectName: "Centium Consulting Inc. : Centium C3CW Implementation",
        },
    },
    {
        name: "Centium/Tonix",
        mapping: {
            netsuiteProjectId: "349637",
            netsuiteProjectName: "Centium Consulting Inc. : Centium Tonix Implementation",
        },
    },
    {
        name: "Dye & Durham",
        mapping: {
            netsuiteProjectId: "328429",
            netsuiteProjectName: "Dye & Durham : Dye & Durham Phase 2",
        },
    },
    {
        name: "FPM",
        mapping: {
            netsuiteProjectId: "204479",
            netsuiteProjectName: "FPM Solutions CPAP Sleep Clinic : FPM Solutions - T&M",
        },
    },
    {
        name: "George Courey",
        mapping: {
            netsuiteProjectId: "365317",
            netsuiteProjectName: "George Courey : George Courey",
        },
    },
    {
        name: "Global Gourmet",
        mapping: {
            netsuiteProjectId: "203911",
            netsuiteProjectName: "Global Gourmet Foods : Global Gourmet Foods",
        },
    },
    {
        name: "Global Light",
        mapping: {
            netsuiteProjectId: "316384",
            netsuiteProjectName: "Global Light Company LLC : Global Light Solutions - 40hrs per month",
        },
    },
    {
        name: "HPSA",
        mapping: {
            netsuiteProjectId: "333587",
            netsuiteProjectName: "Health Products Stewardship Association HPSA : HPSA: Health Steward T&M",
        },
    },
    {
        name: "Happy Feet",
        mapping: {
            netsuiteProjectId: "352336",
            netsuiteProjectName: "Happy Feet International Flooring : Happy Feet International Flooring",
        },
    },
    {
        name: "Jascko",
        mapping: {
            netsuiteProjectId: "352335",
            netsuiteProjectName: "Jascko Corp : Jascko Corp",
        },
    },
    {
        name: "LSCU",
        mapping: {
            netsuiteProjectId: "204155",
            netsuiteProjectName: "The League of Southeastern Credit Unions & Affiliates : Southeastern Credit Unions",
        },
    },
    {
        name: "Mikisew",
        mapping: {
            netsuiteProjectId: "345444",
            netsuiteProjectName: "Mikisew Group : Mikisew Implementation",
        },
    },
    {
        name: "NDI Internal",
        mapping: {
            netsuiteProjectId: "202557",
            netsuiteProjectName: "Internal- NetDynamic Inc. : Internal Projects",
        },
    },
    {
        name: "Pellucere",
        mapping: {
            netsuiteProjectId: "204456",
            netsuiteProjectName: "Pellucere Technologies : Pellucere Technologies - 37hrs per month",
        },
    },
    {
        name: "ROF",
        mapping: {
            netsuiteProjectId: "328531",
            netsuiteProjectName: "Reimagine Office Furnishings : Reimagine Office Furnishings - ATS360",
        },
    },
    {
        name: "SIGA",
        mapping: {
            netsuiteProjectId: "203262",
            netsuiteProjectName: "SIGA International : SIGA International | Managed Services",
        },
    },
    {
        name: "Santec | Canada",
        aliases: ["Santec|Canada"],
        mapping: {
            netsuiteProjectId: "349639",
            netsuiteProjectName: "Santec Instruments : Santec",
        },
    },
    {
        name: "Service Pros",
        mapping: {
            netsuiteProjectId: "356880",
            netsuiteProjectName: "Service Pros Installation Group : Service Pro x ATS360+",
        },
    },
    {
        name: "SodaStream",
        mapping: {
            netsuiteProjectId: "201817",
            netsuiteProjectName: "SodaStream Canada Ltd. : SodaStream Projects and Admin",
        },
    },
    {
        name: "Sparetek",
        mapping: {
            netsuiteProjectId: "204165",
            netsuiteProjectName: "Sparetek : Sparetek Data Migration",
        },
    },
    {
        name: "TIN | ThatsItFruit",
        aliases: ["TIN|ThatsItFruit"],
        mapping: {
            netsuiteProjectId: "201222",
            netsuiteProjectName: "That's It Fruit : That's It Fruit- Dyn : Service 60hrs per month",
        },
    },
    {
        name: "Turing",
        mapping: {
            netsuiteProjectId: "362977",
            netsuiteProjectName: "Turing Enterprises, Inc. : Turing",
        },
    },
];

const DEFAULT_BY_NORMALIZED_NAME = new Map<string, NetSuiteClientMappingDefault>();

function registerMappingKey(rawKey: string, mapping: NetSuiteClientMappingDefault) {
    const key = normalizeNetSuiteClientDirectoryName(rawKey);
    if (!key) return;
    if (!DEFAULT_BY_NORMALIZED_NAME.has(key)) {
        DEFAULT_BY_NORMALIZED_NAME.set(key, mapping);
    }
}

for (const entry of NETSUITE_CLIENT_MAPPING_SEED) {
    registerMappingKey(entry.name, entry.mapping);
    (entry.aliases || []).forEach((alias) => registerMappingKey(alias, entry.mapping));
}

/**
 * Returns the default NetSuite project for a ClientDirectory display name, or null if unknown / no mapping.
 */
export function getDefaultNetSuiteMappingForClientDirectoryName(
    name: string
): NetSuiteClientMappingDefault | null {
    const key = normalizeNetSuiteClientDirectoryName(name);
    if (!key) return null;
    return DEFAULT_BY_NORMALIZED_NAME.get(key) ?? null;
}
