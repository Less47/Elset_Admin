import { randomUUID } from "node:crypto";
import { loadData, saveData } from "../server-store.js";

const DEMO_EMAIL_DOMAIN = "demo.elset.test";
const DEFAULT_CUSTOMER_COUNT = 50;
const DEFAULT_JOB_COUNT = 50;

const firstNames = [
  "Alessio",
  "Mia",
  "Luca",
  "Sofia",
  "Noah",
  "Chloe",
  "Leo",
  "Isla",
  "Elijah",
  "Ava",
  "Oliver",
  "Ruby",
  "Aria",
  "Henry",
  "Matilda",
  "Ethan",
  "Zara",
  "Harper",
  "Oscar",
  "Grace",
];

const lastNames = [
  "Sergio",
  "Romano",
  "Nguyen",
  "Patel",
  "O'Connor",
  "Bianchi",
  "Kaur",
  "Murphy",
  "Rossi",
  "Campbell",
  "Tran",
  "Singh",
  "Dawson",
  "Moretti",
  "Fletcher",
  "Costa",
  "Barrett",
  "Walsh",
  "Greco",
  "Carbone",
];

const customerTypes = [
  "homeowner",
  "business",
  "strata",
  "property-manager",
  "builder",
  "government",
  "other",
];

const siteTypes = ["residential", "commercial", "industrial", "mixed-use"];
const urgencies = ["Low", "Medium", "High"];
const statuses = ["To Do", "In Progress", "Completed"];

const businessPrefixes = [
  "Harbourline",
  "North Arc",
  "Silverline",
  "Elmstone",
  "MetroWest",
  "BluePeak",
  "Summit",
  "Ironclad",
  "Golden Mile",
  "Riverside",
  "Southern Cross",
  "Brightgate",
  "RedGum",
  "Westport",
  "Parklane",
];

const businessSuffixes = [
  "Logistics",
  "Facilities",
  "Developments",
  "Management",
  "Engineering",
  "Industrial",
  "Warehousing",
  "Builders",
  "Property Group",
  "Operations",
  "Community Hub",
  "Retail Centre",
];

const siteLabels = {
  residential: ["Driveway Entry", "Front Gate", "Garage Access", "Side Entry"],
  commercial: ["Main Entry", "Visitor Entry", "Service Lane", "Car Park Gate"],
  industrial: ["Warehouse Gate", "Loading Bay", "Truck Entry", "Rear Compound"],
  "mixed-use": ["Basement Entry", "Retail Access", "Shared Entry", "Service Court"],
};

const accessNotes = [
  "Call site contact 15 minutes before arrival.",
  "Use the intercom at the front entry and avoid blocking the loading lane.",
  "Visitor parking is available beside the main gate.",
  "Check in with reception before isolating the operator.",
  "Best access is before 8:30am while deliveries are light.",
  "Security keeps a spare remote in the front office.",
];

const siteNotes = [
  "Busy site with daily vehicle movements through the main access point.",
  "The control cabinet was upgraded in the last 18 months.",
  "The site sees peak traffic during school pickup and morning deliveries.",
  "Previous service history notes recurring sensor alignment issues in wet weather.",
  "Shared driveway requires safe pedestrian management during testing.",
];

const assetCatalog = {
  residential: [
    { type: "Sliding Gate", model: "FAAC 844" },
    { type: "Swing Gate", model: "BFT Phobos BT A40" },
    { type: "Garage Door", model: "Merlin Commander Elite" },
    { type: "Intercom System", model: "Aiphone GT Series" },
  ],
  commercial: [
    { type: "Sliding Gate", model: "FAAC 741" },
    { type: "Access Control", model: "Inner Range Integriti" },
    { type: "Automatic Door", model: "Dormakaba ES 200" },
    { type: "Intercom System", model: "2N IP Verso" },
  ],
  industrial: [
    { type: "Boom Gate", model: "Magnetic Access Pro" },
    { type: "Sliding Gate", model: "Centurion D10" },
    { type: "Roller Door", model: "ATA GDO-10" },
    { type: "Access Control", model: "HID Signo Keypad" },
  ],
  "mixed-use": [
    { type: "Sliding Gate", model: "FAAC C721" },
    { type: "Boom Gate", model: "BFT Giotto Ultra" },
    { type: "Intercom System", model: "Comelit Ultra" },
    { type: "Access Control", model: "Paxton Net2" },
  ],
};

const jobCatalogByAssetType = {
  "Sliding Gate": [
    {
      title: "Sliding gate motor fault",
      description:
        "Gate intermittently stalls on close cycle. Inspect motor load, track resistance, and limit settings before recommissioning.",
      items: [
        { description: "Fault finding and testing", qty: 1.5, rate: 145 },
        { description: "Track clean and alignment adjustment", qty: 1, rate: 95 },
      ],
    },
    {
      title: "Sliding gate service",
      description:
        "Carry out preventive service, test safety devices, lubricate moving parts, and confirm smooth full travel in both directions.",
      items: [
        { description: "Preventive maintenance labour", qty: 2, rate: 135 },
        { description: "Consumables and lubricants", qty: 1, rate: 28 },
      ],
    },
    {
      title: "Sliding gate safety edge replacement",
      description:
        "Existing safety edge is damaged and causing false stops. Replace edge, reset control inputs, and verify safe reversal.",
      items: [
        { description: "Replacement safety edge", qty: 1, rate: 265 },
        { description: "Install and testing labour", qty: 1.5, rate: 145 },
      ],
    },
  ],
  "Swing Gate": [
    {
      title: "Swing gate arm adjustment",
      description:
        "One leaf is over-travelling at the open limit. Reset arm geometry, confirm force settings, and test close sync.",
      items: [
        { description: "Gate arm adjustment labour", qty: 1.5, rate: 145 },
        { description: "Hardware and consumables", qty: 1, rate: 35 },
      ],
    },
    {
      title: "Swing gate controller upgrade",
      description:
        "Install updated controller board, transfer programming, and verify operation on remote and intercom release.",
      items: [
        { description: "Controller board", qty: 1, rate: 390 },
        { description: "Upgrade labour", qty: 2, rate: 145 },
      ],
    },
  ],
  "Garage Door": [
    {
      title: "Garage door remote issue",
      description:
        "Customer reports intermittent remote range. Test receiver, reprogram remotes, and inspect antenna placement.",
      items: [
        { description: "Diagnostic labour", qty: 1, rate: 135 },
        { description: "Remote reprogramming", qty: 1, rate: 55 },
      ],
    },
  ],
  "Intercom System": [
    {
      title: "Intercom audio fault",
      description:
        "Speech path is cutting out between apartment station and entry panel. Trace wiring, test power supply, and confirm release output.",
      items: [
        { description: "Intercom diagnosis", qty: 1.5, rate: 145 },
        { description: "Minor cable and connectors", qty: 1, rate: 42 },
      ],
    },
  ],
  "Access Control": [
    {
      title: "Access control keypad fault",
      description:
        "Keypad intermittently drops valid credentials. Inspect controller logs, test reader power, and replace damaged keypad if required.",
      items: [
        { description: "Access control fault finding", qty: 1.5, rate: 150 },
        { description: "Replacement keypad allowance", qty: 1, rate: 280 },
      ],
    },
    {
      title: "Access control user update",
      description:
        "Review user access list, update schedules, and verify site release on keypad and remote credentials.",
      items: [
        { description: "Programming labour", qty: 1, rate: 125 },
        { description: "Site verification", qty: 1, rate: 75 },
      ],
    },
  ],
  "Automatic Door": [
    {
      title: "Automatic door sensor reset",
      description:
        "Door is holding open longer than expected. Recalibrate presence sensors, confirm safety zones, and retest the closing cycle.",
      items: [
        { description: "Automatic door service labour", qty: 1.5, rate: 145 },
        { description: "Sensor calibration", qty: 1, rate: 65 },
      ],
    },
  ],
  "Boom Gate": [
    {
      title: "Boom gate annual service",
      description:
        "Carry out annual service, inspect cabinet internals, test safety loops, and confirm arm balance and battery backup.",
      items: [
        { description: "Boom gate maintenance labour", qty: 2, rate: 145 },
        { description: "Battery test and consumables", qty: 1, rate: 48 },
      ],
    },
    {
      title: "Boom gate loop fault",
      description:
        "Barrier is failing to respond consistently on vehicle approach. Test loop detector input, inspect loop wiring, and reset sensitivities.",
      items: [
        { description: "Loop detector fault finding", qty: 1.5, rate: 150 },
        { description: "Loop detector replacement allowance", qty: 1, rate: 215 },
      ],
    },
  ],
  "Roller Door": [
    {
      title: "Roller door limit reset",
      description:
        "Door is stopping short on close cycle. Reset limit positions, inspect curtain travel, and confirm auto-close timing.",
      items: [
        { description: "Roller door adjustment labour", qty: 1.5, rate: 140 },
        { description: "Service call consumables", qty: 1, rate: 24 },
      ],
    },
  ],
};

const addressSeeds = [
  { streetNumber: 12, street: "Collins Street", suburb: "Melbourne", postcode: "3000", siteType: "commercial" },
  { streetNumber: 8, street: "Harbour Esplanade", suburb: "Docklands", postcode: "3008", siteType: "commercial" },
  { streetNumber: 27, street: "Lygon Street", suburb: "Carlton", postcode: "3053", siteType: "mixed-use" },
  { streetNumber: 41, street: "Sydney Road", suburb: "Brunswick", postcode: "3056", siteType: "mixed-use" },
  { streetNumber: 66, street: "Smith Street", suburb: "Fitzroy", postcode: "3065", siteType: "mixed-use" },
  { streetNumber: 14, street: "Brunswick Street", suburb: "Fitzroy", postcode: "3065", siteType: "mixed-use" },
  { streetNumber: 73, street: "High Street", suburb: "Northcote", postcode: "3070", siteType: "mixed-use" },
  { streetNumber: 92, street: "St Georges Road", suburb: "North Fitzroy", postcode: "3068", siteType: "commercial" },
  { streetNumber: 118, street: "Punt Road", suburb: "Richmond", postcode: "3121", siteType: "commercial" },
  { streetNumber: 31, street: "Church Street", suburb: "Richmond", postcode: "3121", siteType: "commercial" },
  { streetNumber: 57, street: "Toorak Road", suburb: "South Yarra", postcode: "3141", siteType: "commercial" },
  { streetNumber: 24, street: "Chapel Street", suburb: "Prahran", postcode: "3181", siteType: "mixed-use" },
  { streetNumber: 82, street: "Barkly Street", suburb: "St Kilda", postcode: "3182", siteType: "mixed-use" },
  { streetNumber: 19, street: "Acland Street", suburb: "St Kilda", postcode: "3182", siteType: "mixed-use" },
  { streetNumber: 104, street: "Glenferrie Road", suburb: "Hawthorn", postcode: "3122", siteType: "commercial" },
  { streetNumber: 28, street: "Cotham Road", suburb: "Kew", postcode: "3101", siteType: "residential" },
  { streetNumber: 17, street: "Bell Street", suburb: "Coburg", postcode: "3058", siteType: "industrial" },
  { streetNumber: 145, street: "Pascoe Vale Road", suburb: "Essendon", postcode: "3040", siteType: "commercial" },
  { streetNumber: 61, street: "Puckle Street", suburb: "Moonee Ponds", postcode: "3039", siteType: "mixed-use" },
  { streetNumber: 26, street: "Union Road", suburb: "Ascot Vale", postcode: "3032", siteType: "commercial" },
  { streetNumber: 38, street: "Ballarat Road", suburb: "Footscray", postcode: "3011", siteType: "industrial" },
  { streetNumber: 55, street: "Buckley Street", suburb: "Maidstone", postcode: "3012", siteType: "commercial" },
  { streetNumber: 88, street: "Ashley Street", suburb: "Braybrook", postcode: "3019", siteType: "industrial" },
  { streetNumber: 12, street: "Somerville Road", suburb: "Yarraville", postcode: "3013", siteType: "industrial" },
  { streetNumber: 97, street: "Pier Street", suburb: "Altona", postcode: "3018", siteType: "commercial" },
  { streetNumber: 44, street: "Aviation Road", suburb: "Laverton", postcode: "3028", siteType: "industrial" },
  { streetNumber: 11, street: "Sayers Road", suburb: "Tarneit", postcode: "3029", siteType: "residential" },
  { streetNumber: 63, street: "Point Cook Road", suburb: "Point Cook", postcode: "3030", siteType: "residential" },
  { streetNumber: 29, street: "Synnot Street", suburb: "Werribee", postcode: "3030", siteType: "mixed-use" },
  { streetNumber: 51, street: "High Street", suburb: "Melton", postcode: "3337", siteType: "commercial" },
  { streetNumber: 76, street: "Brook Street", suburb: "Sunbury", postcode: "3429", siteType: "industrial" },
  { streetNumber: 33, street: "Mickleham Road", suburb: "Tullamarine", postcode: "3043", siteType: "industrial" },
  { streetNumber: 102, street: "Cooper Street", suburb: "Epping", postcode: "3076", siteType: "industrial" },
  { streetNumber: 47, street: "Mahoneys Road", suburb: "Thomastown", postcode: "3074", siteType: "industrial" },
  { streetNumber: 58, street: "Plenty Road", suburb: "Reservoir", postcode: "3073", siteType: "mixed-use" },
  { streetNumber: 21, street: "Upper Heidelberg Road", suburb: "Ivanhoe", postcode: "3079", siteType: "commercial" },
  { streetNumber: 84, street: "Burgundy Street", suburb: "Heidelberg", postcode: "3084", siteType: "mixed-use" },
  { streetNumber: 62, street: "Whitehorse Road", suburb: "Box Hill", postcode: "3128", siteType: "commercial" },
  { streetNumber: 40, street: "Canterbury Road", suburb: "Ringwood", postcode: "3134", siteType: "industrial" },
  { streetNumber: 91, street: "Springvale Road", suburb: "Glen Waverley", postcode: "3150", siteType: "commercial" },
  { streetNumber: 16, street: "Scoresby Road", suburb: "Bayswater", postcode: "3153", siteType: "industrial" },
  { streetNumber: 70, street: "Burwood Highway", suburb: "Ferntree Gully", postcode: "3156", siteType: "mixed-use" },
  { streetNumber: 53, street: "Clayton Road", suburb: "Clayton", postcode: "3168", siteType: "industrial" },
  { streetNumber: 89, street: "Princes Highway", suburb: "Dandenong", postcode: "3175", siteType: "industrial" },
  { streetNumber: 42, street: "Wells Road", suburb: "Seaford", postcode: "3198", siteType: "industrial" },
  { streetNumber: 31, street: "Nepean Highway", suburb: "Frankston", postcode: "3199", siteType: "commercial" },
  { streetNumber: 22, street: "Bay Road", suburb: "Sandringham", postcode: "3191", siteType: "commercial" },
  { streetNumber: 15, street: "Beach Street", suburb: "Port Melbourne", postcode: "3207", siteType: "industrial" },
  { streetNumber: 48, street: "Clarendon Street", suburb: "Southbank", postcode: "3006", siteType: "commercial" },
  { streetNumber: 7, street: "Burke Road", suburb: "Camberwell", postcode: "3124", siteType: "commercial" },
  { streetNumber: 13, street: "Doncaster Road", suburb: "Balwyn North", postcode: "3104", siteType: "residential" },
];

function parseCountArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) return fallback;
  const value = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRng(20260508);

function pick(list) {
  return list[Math.floor(random() * list.length)] || list[0];
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatAddress(seed, offset = 0) {
  return `${seed.streetNumber + offset} ${seed.street}, ${seed.suburb} VIC ${seed.postcode}, Australia`;
}

function daysAgoIso(days, hour = 9) {
  const date = new Date();
  date.setHours(hour, Math.floor(random() * 50), 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function daysFromNowDateInput(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function phoneFor(index) {
  return `04${String(10000000 + index * 173).slice(-8)}`;
}

function buildCustomerName(type, seed, index) {
  if (type === "homeowner") {
    return `${pick(firstNames)} ${pick(lastNames)}`;
  }

  if (type === "strata") {
    return `${seed.suburb} Owners Corporation ${200 + index}`;
  }

  if (type === "property-manager") {
    return `${pick(businessPrefixes)} Property Group`;
  }

  if (type === "builder") {
    return `${pick(businessPrefixes)} Projects`;
  }

  if (type === "government") {
    return `${seed.suburb} City Services`;
  }

  if (type === "other") {
    return `${pick(businessPrefixes)} ${pick(["Community Hub", "Leisure Centre", "Sports Club", "Business Precinct"])}`;
  }

  return `${pick(businessPrefixes)} ${pick(businessSuffixes)}`;
}

function buildSiteAssets(siteType) {
  const primaryAsset = pick(assetCatalog[siteType] || assetCatalog.commercial);
  const secondaryAsset = random() > 0.62 ? pick(assetCatalog[siteType] || assetCatalog.commercial) : null;
  const assets = [
    {
      id: randomUUID(),
      name: primaryAsset.type === "Boom Gate" ? "Primary boom gate" : "Main access system",
      type: primaryAsset.type,
      location: pick(["Front entry", "Driveway", "Loading bay", "Car park", "Visitor lane"]),
      model: primaryAsset.model,
      notes: pick(siteNotes),
      updatedAt: daysAgoIso(Math.floor(random() * 25) + 1, 11),
    },
  ];

  if (secondaryAsset) {
    assets.push({
      id: randomUUID(),
      name: secondaryAsset.type === "Intercom System" ? "Visitor intercom" : "Secondary access point",
      type: secondaryAsset.type,
      location: pick(["Rear lane", "Office side gate", "Basement entry", "Service court"]),
      model: secondaryAsset.model,
      notes: pick(siteNotes),
      updatedAt: daysAgoIso(Math.floor(random() * 25) + 1, 12),
    });
  }

  return assets;
}

function buildCustomer(seed, index) {
  const customerType = customerTypes[index % customerTypes.length];
  const siteType = seed.siteType || pick(siteTypes);
  const name = buildCustomerName(customerType, seed, index);
  const primaryAddress = formatAddress(seed);
  const createdAt = daysAgoIso(Math.floor(random() * 150) + 20, 10);
  const contactName = customerType === "homeowner" ? name : `${pick(firstNames)} ${pick(lastNames)}`;
  const contactPhone = phoneFor(index + 40);
  const primarySite = {
    id: randomUUID(),
    label: pick(siteLabels[siteType] || siteLabels.commercial),
    address: primaryAddress,
    siteType,
    accessNotes: pick(accessNotes),
    notes: pick(siteNotes),
    contactName,
    contactPhone,
    assets: buildSiteAssets(siteType),
    createdAt,
    updatedAt: daysAgoIso(Math.floor(random() * 30) + 1, 11),
  };

  const sites = [primarySite];
  if (index % 4 === 0) {
    sites.push({
      id: randomUUID(),
      label: pick(["Rear Entry", "Overflow Yard", "Basement Access", "Secondary Gate"]),
      address: formatAddress(seed, 6 + (index % 3)),
      siteType,
      accessNotes: pick(accessNotes),
      notes: pick(siteNotes),
      contactName,
      contactPhone,
      assets: buildSiteAssets(siteType),
      createdAt,
      updatedAt: daysAgoIso(Math.floor(random() * 20) + 1, 13),
    });
  }

  return {
    id: randomUUID(),
    name,
    email: `${slugify(name)}-${String(index + 1).padStart(2, "0")}@${DEMO_EMAIL_DOMAIN}`,
    phone: phoneFor(index + 1),
    customerType,
    address: primaryAddress,
    sites,
    siteAccessNotes: sites
      .filter((site) => site.accessNotes)
      .map((site) => ({
        id: randomUUID(),
        address: site.address,
        notes: site.accessNotes,
        updatedAt: site.updatedAt,
      })),
    createdAt,
  };
}

function pickJobTemplate(assetType) {
  return pick(jobCatalogByAssetType[assetType] || jobCatalogByAssetType["Sliding Gate"]);
}

function buildDocumentItems(templateItems) {
  return templateItems.map((item) => ({
    id: randomUUID(),
    description: item.description,
    qty: item.qty,
    rate: item.rate,
  }));
}

function totalForItems(items) {
  return items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0), 0);
}

function buildQuote(issueOffsetDays, template) {
  return {
    type: "quote",
    issueDate: daysFromNowDateInput(issueOffsetDays),
    notes: "Quote valid for 14 days. Pricing includes listed labour and standard consumables only.",
    sentHistory: random() > 0.55
      ? [
          {
            id: randomUUID(),
            sentAt: daysAgoIso(Math.max(1, 14 - issueOffsetDays), 15),
            fromEmail: "admin@elset.com.au",
            toEmail: "",
          },
        ]
      : [],
    items: buildDocumentItems(template.items),
  };
}

function buildInvoice(issueDateOffsetDays, template, statusIndex) {
  const items = buildDocumentItems(template.items);
  const total = totalForItems(items);
  const issueDate = daysFromNowDateInput(issueDateOffsetDays);
  const dueDate = daysFromNowDateInput(issueDateOffsetDays + 7);
  let payments = [];

  if (statusIndex % 3 === 0) {
    payments = [
      {
        id: randomUUID(),
        amount: total,
        date: daysFromNowDateInput(issueDateOffsetDays + 3),
        method: "Bank Transfer",
        reference: `PAY-${Math.floor(1000 + random() * 9000)}`,
        notes: "Paid in full.",
        createdAt: daysAgoIso(Math.max(1, 8 - issueDateOffsetDays), 14),
      },
    ];
  } else if (statusIndex % 3 === 1) {
    payments = [
      {
        id: randomUUID(),
        amount: Number((total * 0.4).toFixed(2)),
        date: daysFromNowDateInput(issueDateOffsetDays + 2),
        method: "Card",
        reference: `DEP-${Math.floor(1000 + random() * 9000)}`,
        notes: "Deposit received.",
        createdAt: daysAgoIso(Math.max(1, 9 - issueDateOffsetDays), 13),
      },
    ];
  }

  return {
    type: "invoice",
    issueDate,
    dueDate,
    notes: "Invoice issued following site attendance and final testing.",
    paymentNotes: "Payment due within 7 days.",
    payments,
    sentHistory: random() > 0.45
      ? [
          {
            id: randomUUID(),
            sentAt: daysAgoIso(Math.max(1, 10 - issueDateOffsetDays), 16),
            fromEmail: "admin@elset.com.au",
            toEmail: "",
          },
        ]
      : [],
    items,
  };
}

function buildJob(customer, index, nextJobNumber, staffMembers) {
  const status = statuses[index % statuses.length];
  const urgency = urgencies[(index + 1) % urgencies.length];
  const assignedTechnician = staffMembers[index % staffMembers.length];
  const site = customer.sites[index % customer.sites.length] || customer.sites[0];
  const asset = site.assets[index % site.assets.length] || site.assets[0];
  const template = pickJobTemplate(asset?.type);
  const createdDaysAgo = Math.floor(random() * 70) + 4;
  const createdAt = daysAgoIso(createdDaysAgo, 8);
  const updatedAt = status === "Completed"
    ? daysAgoIso(Math.max(1, createdDaysAgo - 2), 15)
    : status === "In Progress"
      ? daysAgoIso(Math.max(0, createdDaysAgo - 1), 12)
      : daysAgoIso(Math.max(0, createdDaysAgo - 3), 10);

  const scheduledDate = status === "Completed"
    ? daysFromNowDateInput(-(Math.floor(random() * 35) + 2))
    : index % 5 === 0
      ? ""
      : daysFromNowDateInput((index % 9) - 3);

  const noteBase = {
    id: randomUUID(),
    author: assignedTechnician?.name || "Technician",
    createdAt: updatedAt,
  };

  const notes = status === "To Do"
    ? []
    : status === "In Progress"
      ? [
          {
            ...noteBase,
            text: "On site and working through diagnostics. Parts requirement will be confirmed after testing.",
          },
        ]
      : [
          {
            ...noteBase,
            text: "Work completed, system tested, and site contact walked through operation.",
          },
        ];

  const quote = status === "Completed"
    ? (index % 2 === 0 ? buildQuote(-(Math.floor(random() * 25) + 12), template) : null)
    : index % 3 !== 0
      ? buildQuote(-(Math.floor(random() * 12) + 1), template)
      : null;

  if (quote?.sentHistory?.length > 0) {
    quote.sentHistory = quote.sentHistory.map((entry) => ({
      ...entry,
      toEmail: customer.email,
    }));
  }

  const invoice = status === "Completed" && index % 5 !== 0
    ? buildInvoice(-(Math.floor(random() * 18) + 1), template, index)
    : null;

  if (invoice?.sentHistory?.length > 0) {
    invoice.sentHistory = invoice.sentHistory.map((entry) => ({
      ...entry,
      toEmail: customer.email,
    }));
  }

  return {
    id: randomUUID(),
    jobNumber: nextJobNumber + index,
    title: template.title,
    description: template.description,
    urgency,
    status,
    scheduledDate,
    assignedTechnicianId: assignedTechnician?.id || "",
    assignedTechnicianName: assignedTechnician?.name || "",
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    jobAddress: site.address,
    maintenancePlanId: "",
    maintenancePlanName: "",
    maintenanceDueDate: "",
    createdAt,
    updatedAt,
    notes,
    photos: [],
    quote,
    invoice,
  };
}

function isDemoCustomer(customer) {
  return String(customer?.email || "").toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

function isDemoDeletedCustomer(record) {
  return isDemoCustomer(record?.customer);
}

function isDemoDeletedJob(record, demoCustomerIds) {
  return demoCustomerIds.has(record?.job?.customerId) || String(record?.job?.customerEmail || "").toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

const customerCount = parseCountArg("customers", DEFAULT_CUSTOMER_COUNT);
const jobCount = parseCountArg("jobs", DEFAULT_JOB_COUNT);
const data = loadData();
const staffMembers = Array.isArray(data.staff) && data.staff.length > 0 ? data.staff : [
  { id: "tech-1", name: "Massimo" },
  { id: "tech-2", name: "Domenic" },
];

const existingDemoCustomerIds = new Set(
  (data.customers || [])
    .filter(isDemoCustomer)
    .map((customer) => customer.id)
);

const baseCustomers = (data.customers || []).filter((customer) => !existingDemoCustomerIds.has(customer.id));
const baseJobs = (data.jobs || []).filter((job) => !existingDemoCustomerIds.has(job.customerId));
const baseDeletedCustomers = (data.deletedCustomers || []).filter((record) => !isDemoDeletedCustomer(record));
const baseDeletedJobs = (data.deletedJobs || []).filter((record) => !isDemoDeletedJob(record, existingDemoCustomerIds));

const generatedCustomers = Array.from({ length: customerCount }, (_, index) => buildCustomer(addressSeeds[index % addressSeeds.length], index));
const nextJobNumber =
  baseJobs.reduce((max, job) => Math.max(max, Number(job?.jobNumber || 0)), 0) + 1;

const generatedJobs = Array.from({ length: jobCount }, (_, index) =>
  buildJob(generatedCustomers[index % generatedCustomers.length], index, nextJobNumber, staffMembers)
);

const nextData = {
  ...data,
  customers: [...baseCustomers, ...generatedCustomers],
  jobs: [...generatedJobs, ...baseJobs],
  deletedCustomers: baseDeletedCustomers,
  deletedJobs: baseDeletedJobs,
};

const saved = saveData(nextData);
const savedDemoCustomers = saved.customers.filter(isDemoCustomer);
const savedDemoCustomerIds = new Set(savedDemoCustomers.map((customer) => customer.id));
const savedDemoJobs = saved.jobs.filter((job) => savedDemoCustomerIds.has(job.customerId));

console.log(
  `Saved ${savedDemoCustomers.length} demo customers and ${savedDemoJobs.length} demo jobs to data/app-data.json.`
);
