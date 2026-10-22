import type { Deck, SlidePin } from "@/game/world/office/presentation/slides";
import { SIMTORA_LOCATIONS } from "./simtora";

/** Each office's role, approximate headcount and focus (`Company-Overview.pdf` pp. 12–13). */
const OFFICE_FOCUS: Record<string, { role: string; focus: string }> = {
  "san-francisco": { role: "Headquarters · about 55", focus: "Executive team, product management, engineering leadership, sales, marketing and the corporate functions" },
  lahore: { role: "Largest R&D centre · about 45", focus: "Simtora Flow, platform services, quality engineering and test automation, Tier 2 support" },
  berlin: { role: "R&D centre · about 18", focus: "Simtora Shield engineering, security research, privacy engineering for the EU" },
  paris: { role: "R&D centre · about 15", focus: "Applied AI and machine-learning research for Simtora Assist, developer experience" },
  sydney: { role: "R&D centre · about 14", focus: "Simtora Insight data platform, Asia-Pacific site reliability and support coverage" },
  london: { role: "R&D centre · about 18", focus: "AI evaluation, safety and red-teaming for Simtora Assist, platform and EMEA customer engineering" },
};

const SIMTORA_PINS: SlidePin[] = SIMTORA_LOCATIONS.map((office) => ({
  id: office.id,
  name: office.name,
  role: OFFICE_FOCUS[office.id]?.role ?? "",
  focus: OFFICE_FOCUS[office.id]?.focus ?? "",
  lat: office.lat,
  lon: office.lon,
  hq: office.role === "hq",
}));

/**
 * "About Simtora", part two of the presentation room's loop (phase O7 › Decks), paraphrased from
 * SIM-OVR-001 (`docs/policies/Company-Overview.pdf`, v1.1) and checked against it. Source pages
 * per slide:
 *   1. At a glance ............... p. 3 (the at-a-glance table)
 *   2. Our story ................. p. 4 (milestones)
 *   3. Mission, vision, values ... p. 5
 *   4. Product lines ............. pp. 7–10 (§5)
 *   5. Global footprint .......... pp. 11–13 (§6.1; the "Other U.S. locations" row is p. 12)
 *   6. Customers and markets ..... pp. 16–17 (§7)
 *   7. Executive leadership ...... pp. 20–23 (§9; the PDF marks the names as fictitious)
 *   8. Our policy framework ...... pp. 30–33 (§14.1, §14.3; supplements from p. 1)
 * Re-check these if the overview gets a new version.
 */
export const SIMTORA_DECK: Deck = {
  id: "company",
  title: "About Simtora",
  slides: [
    {
      id: "at-a-glance",
      kind: "stat-grid",
      title: "Simtora at a glance",
      stats: [
        { label: "Founded", value: "2016", note: "Privately held U.S. C corporation" },
        { label: "Headquarters", value: "San Francisco", note: "California, United States" },
        { label: "Employees", value: "About 230", note: "In six countries: about 120 in the U.S., 110 abroad" },
        { label: "Customers", value: "About 900", note: "Organizations in North America, Europe and Asia-Pacific" },
        { label: "Offices", value: "HQ + 5 R&D centres", note: "Lahore, Berlin, Paris, Sydney and London" },
        { label: "Assurance", value: "SOC 2 Type II", note: "A report every year; ISO 27001 is a stated target" },
      ],
      body: "Enterprise software and IT services for cloud, data, security and AI: subscription software plus professional and managed services.",
      source: "SIM-OVR-001 · p. 3",
      speakerLine: "Simtora in one table: founded in 2016, about 230 people, about 900 customers.",
      durationS: 14,
    },
    {
      id: "story",
      kind: "bullets",
      title: "Our story",
      items: [
        { term: "2016", text: "Founded in San Francisco by engineers and operations leaders; first customers onboarded" },
        { term: "2017", text: "Simtora Flow generally available" },
        { term: "2018", text: "Lahore opens, the first engineering site outside the U.S." },
        { term: "2019", text: "Simtora Insight launched" },
        { term: "2021", text: "Simtora Shield and the first SOC 2 Type II report; Berlin opens" },
        { term: "2022", text: "London opens for AI evaluation and safety" },
        { term: "2023", text: "Services practices formalized; Paris opens for applied AI research" },
        { term: "2024", text: "Simtora Assist enters beta; Sydney opens" },
        { term: "2025", text: "Assist generally available; customers pass 800" },
        { term: "2026", text: "The first complete set of policy manuals, then the international supplements" },
      ],
      source: "SIM-OVR-001 · p. 4",
      speakerLine: "Ten years, four products and five R&D centres, starting with a small team in San Francisco.",
      durationS: 15,
    },
    {
      id: "mission",
      kind: "quote",
      title: "Mission, vision and values",
      quote: {
        text: "To make technology simple, secure and intelligent for every organization we serve, so that teams can spend their time on the work that matters.",
        source: "Our mission",
      },
      body: "Vision: to be the most trusted software partner for organizations that run on data, automation and AI.",
      items: [
        { term: "Customer trust", text: "We protect the trust customers place in us, and never overpromise." },
        { term: "Integrity", text: "We do the right thing when nobody is watching, and speak up." },
        { term: "Simplicity", text: "If a process or product is hard to explain, we fix it." },
        { term: "Ownership", text: "We take responsibility for our work and its consequences." },
        { term: "Respect", text: "Dignity for every person, and feedback given and received openly." },
        { term: "Continuous learning", text: "We stay curious and share what we know." },
      ],
      source: "SIM-OVR-001 · p. 5",
      speakerLine: "Simple, secure and intelligent: that's the mission. Six values tell us how to get there.",
      durationS: 15,
    },
    {
      id: "products",
      kind: "bullets",
      title: "Four products, two services",
      body: "They share one identity system, one data platform and one security model.",
      items: [
        { term: "Simtora Flow", text: "Low-code workflow automation and integration, with 300+ prebuilt connectors." },
        { term: "Simtora Insight", text: "Analytics and observability: one data layer for dashboards, alerts and reports." },
        { term: "Simtora Shield", text: "Security and compliance automation: continuous control monitoring and audit evidence." },
        { term: "Simtora Assist", text: "AI assistants and agents that answer from approved company content and cite sources." },
        { term: "Services", text: "Professional services to implement, and managed services and support to run it." },
      ],
      source: "SIM-OVR-001 · pp. 7–10",
      speakerLine: "Flow automates, Insight measures, Shield protects, and Assist answers. Services help customers run them.",
      durationS: 15,
    },
    {
      id: "footprint",
      kind: "map",
      title: "Global footprint",
      body: "Headquarters in San Francisco and five R&D centres in four time zones; about 65 more people work from U.S. regional hubs or remotely.",
      pins: SIMTORA_PINS,
      source: "SIM-OVR-001 · pp. 11–13",
      speakerLine: "Six offices, one engineering organization, and support that follows the sun.",
      durationS: 15,
    },
    {
      id: "customers",
      kind: "stat-grid",
      title: "Customers and markets",
      stats: [
        { label: "North America", value: "About 60%", note: "From San Francisco, other U.S. sites and Lahore" },
        { label: "Europe and the UK", value: "About 25%", note: "From London, Berlin and Paris" },
        { label: "Asia-Pacific", value: "About 15%", note: "From Sydney and Lahore" },
        { label: "Growth companies", value: "50–500", note: "Employees: fast setup, first certifications" },
        { label: "Mid-market", value: "500–5,000", note: "Employees: automation across departments" },
        { label: "Enterprise", value: "Large", note: "And regulated organizations" },
      ],
      body: "Software, financial services, healthcare, retail, professional services, education and the public sector. Customers choose a U.S., EU, UK or Australian hosting region.",
      source: "SIM-OVR-001 · pp. 16–17",
      speakerLine: "About 900 customers, most of them in North America, from startups to regulated enterprises.",
      durationS: 15,
    },
    {
      id: "leadership",
      kind: "bullets",
      title: "Executive leadership",
      body: "The names are fictitious, like the company.",
      items: [
        { term: "CEO", text: "Daniel Reyes · co-founder; strategy and the Executive Team" },
        { term: "CFO", text: "Priya Nair · Finance, Procurement and Facilities" },
        { term: "Chief People Officer", text: "Marcus Ellison · HR, talent and learning" },
        { term: "General Counsel", text: "Hannah Whitfield · Legal, Compliance and Privacy" },
        { term: "Head of IT / CISO", text: "Omar Haddad · IT and security" },
        { term: "Engineering and Product", text: "Elena Vasquez · product, engineering, the R&D centres" },
        { term: "Sales", text: "Thomas Okafor · sales and partnerships" },
        { term: "Customer Success", text: "Grace Lin · success, support and services" },
        { term: "Marketing", text: "Sofia Bianchi · brand and communications" },
        { term: "Procurement", text: "Aisha Rahman · sourcing and vendors" },
        { term: "Facilities", text: "Robert Kowalski · workplace and safety" },
      ],
      source: "SIM-OVR-001 · pp. 20–23",
      speakerLine: "The Executive Team reports to the CEO, and through the CEO to the Board.",
      durationS: 16,
    },
    {
      id: "policy-framework",
      kind: "bullets",
      title: "Our policy framework",
      body: "Where two rules differ, you get the more protective on employment rights and the stricter on security and ethics.",
      items: [
        { term: "People", text: "HR Policy Manual, the Global People Supplement and five country manuals", code: "SIM-HR-001", room: "HR" },
        { term: "Technology", text: "IT Policy Manual: access, devices, data, AI tools", code: "SIM-IT-001", room: "IT" },
        { term: "Ethics", text: "Code of Ethics and Compliance Manual: gifts, conflicts, speaking up", code: "SIM-CMP-001", room: "Compliance" },
        { term: "Money", text: "Finance and Accounting Manual: approvals, expenses, payroll", code: "SIM-FIN-001", room: "Finance" },
        { term: "Buying", text: "Procurement Policy Manual: sourcing, vendors, contracts", code: "SIM-PRC-001", room: "Procurement" },
        { term: "Workplace", text: "Facilities and Office Administration Manual: badges, visitors, safety", code: "SIM-FAC-001", room: "Facilities" },
        { term: "Abroad", text: "International Operations Supplement: local law in each country", code: "SIM-GLB-001", room: "International" },
      ],
      source: "SIM-OVR-001 · pp. 1, 30–33",
      speakerLine: "Six manuals and their supplements. Each one has a room down the corridor, with an expert in it.",
      durationS: 16,
    },
  ],
};
