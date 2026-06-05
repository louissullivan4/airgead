// Per-business-type category templates. The `org_category` slug chosen at signup
// selects one of these trees, which is seeded into `organisations.categories`
// (jsonb) and is owner-editable thereafter. When an org has no stored tree we
// fall back to the matching template at read time (see organisationController).
//
// Tree shape (recursive, max 2 levels used today):
//   Node = { slug, label, children?: Node[] }
//   Template = { expense: Node[], income: Node[] }
//
// The leaf slug a user picks is what gets stored in `expenses.category` (free
// text) — so slugs are stable identifiers; labels are display-only and editable.
//
// !!! ORG_CATEGORY_SLUGS MUST stay in sync with the CHECK constraint in
// migrations/005_org_profile_fields.sql and ORG_CATEGORIES in
// frontend/src/lib/org.ts. !!!
//
// The Irish-tax-aware content below is a sensible first cut, intended to be
// refined against real Revenue allowable-expense categories (by the owner via
// the in-app editor, or by editing this seed file).

const ORG_CATEGORY_SLUGS = [
    'personal',
    'sole_trader_equine',
    'sole_trader_agriculture',
    'consultant',
    'retail',
    'trades_construction',
    'hospitality',
    'other',
];

// Generic fallback — mirrors the historical hardcoded list so personal/other
// orgs (and any org with no stored tree) still get a usable set on day one.
const DEFAULT_TEMPLATE = {
    expense: [
        { slug: 'office', label: 'Office' },
        { slug: 'travel', label: 'Travel' },
        { slug: 'meals', label: 'Meals' },
        { slug: 'utilities', label: 'Utilities' },
        { slug: 'software', label: 'Software' },
        { slug: 'equipment', label: 'Equipment' },
        { slug: 'professional', label: 'Professional' },
        { slug: 'other', label: 'Other' },
    ],
    income: [
        { slug: 'sales', label: 'Sales' },
        { slug: 'other_income', label: 'Other income' },
    ],
};

const CATEGORY_TEMPLATES = {
    personal: DEFAULT_TEMPLATE,
    other: DEFAULT_TEMPLATE,

    sole_trader_equine: {
        expense: [
            { slug: 'feed_bedding', label: 'Feed & Bedding' },
            {
                slug: 'veterinary',
                label: 'Veterinary & Medical',
                children: [
                    { slug: 'vet_fees', label: 'Vet Fees' },
                    { slug: 'farrier', label: 'Farrier' },
                    { slug: 'dentist', label: 'Dentist' },
                    { slug: 'medication', label: 'Medication & Supplements' },
                ],
            },
            { slug: 'livery', label: 'Livery & Stabling' },
            {
                slug: 'training_entry',
                label: 'Training & Entry Fees',
                children: [
                    { slug: 'lessons', label: 'Lessons & Training' },
                    { slug: 'competition_entry', label: 'Competition Entries' },
                    { slug: 'registration', label: 'Registrations & Memberships' },
                ],
            },
            {
                slug: 'motor_transport',
                label: 'Motor, Transport & Horsebox',
                children: [
                    { slug: 'fuel', label: 'Fuel' },
                    { slug: 'mileage', label: 'Mileage' },
                    { slug: 'horsebox_maintenance', label: 'Horsebox Maintenance' },
                    { slug: 'motor_tax_insurance', label: 'Motor Tax & Insurance' },
                ],
            },
            { slug: 'tack_equipment', label: 'Tack & Equipment' },
            { slug: 'insurance', label: 'Insurance' },
            { slug: 'professional', label: 'Professional Fees' },
            { slug: 'utilities', label: 'Utilities' },
            { slug: 'other', label: 'Other' },
        ],
        income: [
            { slug: 'horse_sales', label: 'Horse Sales' },
            { slug: 'prize_money', label: 'Prize Money' },
            { slug: 'stud_breeding', label: 'Stud & Breeding Fees' },
            { slug: 'livery_income', label: 'Livery Income' },
            { slug: 'other_income', label: 'Other income' },
        ],
    },

    sole_trader_agriculture: {
        expense: [
            {
                slug: 'feed_fertiliser',
                label: 'Feed & Fertiliser',
                children: [
                    { slug: 'animal_feed', label: 'Animal Feed' },
                    { slug: 'fertiliser', label: 'Fertiliser & Lime' },
                    { slug: 'seeds', label: 'Seeds & Plants' },
                ],
            },
            { slug: 'veterinary', label: 'Veterinary & Medicine' },
            {
                slug: 'machinery',
                label: 'Machinery & Equipment',
                children: [
                    { slug: 'machinery_purchase', label: 'Machinery (Capital)' },
                    { slug: 'machinery_repairs', label: 'Repairs & Parts' },
                    { slug: 'plant_hire', label: 'Plant & Equipment Hire' },
                ],
            },
            { slug: 'contractor', label: 'Contractor Charges' },
            {
                slug: 'fuel_motor',
                label: 'Fuel & Motor',
                children: [
                    { slug: 'diesel', label: 'Diesel & Oil' },
                    { slug: 'mileage', label: 'Mileage' },
                    { slug: 'motor_tax_insurance', label: 'Motor Tax & Insurance' },
                ],
            },
            { slug: 'land_rent', label: 'Land Rent & Conacre' },
            { slug: 'insurance', label: 'Insurance' },
            { slug: 'utilities', label: 'Utilities (ESB, Water)' },
            { slug: 'building_fencing', label: 'Building & Fencing Repairs' },
            { slug: 'professional', label: 'Professional Fees' },
            { slug: 'other', label: 'Other' },
        ],
        income: [
            { slug: 'livestock_sales', label: 'Livestock Sales' },
            { slug: 'crop_sales', label: 'Crop Sales' },
            { slug: 'milk', label: 'Milk' },
            { slug: 'eu_payments', label: 'EU / CAP Payments (BISS)' },
            { slug: 'contracting_income', label: 'Contracting Income' },
            { slug: 'other_income', label: 'Other income' },
        ],
    },

    consultant: {
        expense: [
            { slug: 'software', label: 'Software & Subscriptions' },
            {
                slug: 'professional',
                label: 'Professional Fees',
                children: [
                    { slug: 'accountancy', label: 'Accountancy' },
                    { slug: 'legal', label: 'Legal' },
                ],
            },
            { slug: 'home_office', label: 'Home Office' },
            {
                slug: 'travel_subsistence',
                label: 'Travel & Subsistence',
                children: [
                    { slug: 'flights', label: 'Flights & Transport' },
                    { slug: 'accommodation', label: 'Accommodation' },
                    { slug: 'subsistence', label: 'Subsistence' },
                    { slug: 'mileage', label: 'Mileage' },
                ],
            },
            { slug: 'equipment', label: 'Equipment & Hardware' },
            { slug: 'training_cpd', label: 'Training & CPD' },
            { slug: 'marketing', label: 'Marketing & Website' },
            { slug: 'phone_internet', label: 'Phone & Internet' },
            { slug: 'insurance', label: 'Insurance (PI)' },
            { slug: 'bank_charges', label: 'Bank Charges' },
            { slug: 'other', label: 'Other' },
        ],
        income: [
            { slug: 'consulting_fees', label: 'Consulting Fees' },
            { slug: 'retainer', label: 'Retainer' },
            { slug: 'other_income', label: 'Other income' },
        ],
    },

    retail: {
        expense: [
            { slug: 'stock_purchases', label: 'Stock & Purchases' },
            { slug: 'rent_rates', label: 'Rent & Rates' },
            { slug: 'utilities', label: 'Utilities' },
            { slug: 'wages', label: 'Wages & Staff' },
            { slug: 'packaging', label: 'Packaging & Postage' },
            { slug: 'marketing', label: 'Marketing & Advertising' },
            { slug: 'bank_card_fees', label: 'Bank & Card Fees' },
            { slug: 'equipment_fixtures', label: 'Equipment & Fixtures' },
            { slug: 'insurance', label: 'Insurance' },
            {
                slug: 'motor_delivery',
                label: 'Motor & Delivery',
                children: [
                    { slug: 'fuel', label: 'Fuel' },
                    { slug: 'mileage', label: 'Mileage' },
                    { slug: 'vehicle_repairs', label: 'Vehicle Repairs' },
                ],
            },
            { slug: 'professional', label: 'Professional Fees' },
            { slug: 'other', label: 'Other' },
        ],
        income: [
            { slug: 'sales', label: 'Shop Sales' },
            { slug: 'online_sales', label: 'Online Sales' },
            { slug: 'other_income', label: 'Other income' },
        ],
    },

    trades_construction: {
        expense: [
            { slug: 'materials', label: 'Materials' },
            { slug: 'subcontractor', label: 'Subcontractor Costs (RCT)' },
            { slug: 'tools_equipment', label: 'Tools & Equipment' },
            { slug: 'plant_hire', label: 'Plant Hire' },
            {
                slug: 'motor_fuel',
                label: 'Motor & Fuel',
                children: [
                    { slug: 'fuel', label: 'Fuel' },
                    { slug: 'mileage', label: 'Mileage' },
                    { slug: 'vehicle_repairs', label: 'Repairs & Servicing' },
                    { slug: 'motor_tax_insurance', label: 'Motor Tax & Insurance' },
                ],
            },
            { slug: 'protective_clothing', label: 'Protective Clothing & PPE' },
            { slug: 'insurance', label: 'Insurance (Public Liability)' },
            { slug: 'phone', label: 'Phone' },
            { slug: 'professional', label: 'Professional Fees' },
            { slug: 'waste', label: 'Waste & Skip Hire' },
            { slug: 'other', label: 'Other' },
        ],
        income: [
            { slug: 'contract_income', label: 'Contract Income' },
            { slug: 'day_work', label: 'Day Work' },
            { slug: 'other_income', label: 'Other income' },
        ],
    },

    hospitality: {
        expense: [
            {
                slug: 'food_beverage',
                label: 'Food & Beverage Purchases',
                children: [
                    { slug: 'food', label: 'Food' },
                    { slug: 'beverage', label: 'Beverage' },
                    { slug: 'alcohol', label: 'Alcohol' },
                ],
            },
            { slug: 'wages', label: 'Wages & Staff' },
            { slug: 'rent_rates', label: 'Rent & Rates' },
            { slug: 'utilities', label: 'Utilities' },
            { slug: 'cleaning_laundry', label: 'Cleaning & Laundry' },
            { slug: 'licences', label: 'Licences & Permits' },
            { slug: 'marketing', label: 'Marketing' },
            { slug: 'equipment_furniture', label: 'Equipment & Furniture' },
            { slug: 'repairs_maintenance', label: 'Repairs & Maintenance' },
            { slug: 'insurance', label: 'Insurance' },
            { slug: 'bank_card_fees', label: 'Bank & Card Fees' },
            { slug: 'other', label: 'Other' },
        ],
        income: [
            { slug: 'food_sales', label: 'Food Sales' },
            { slug: 'beverage_sales', label: 'Beverage Sales' },
            { slug: 'accommodation', label: 'Accommodation' },
            { slug: 'functions', label: 'Functions & Events' },
            { slug: 'other_income', label: 'Other income' },
        ],
    },
};

// Returns the template tree for an org_category slug, falling back to the
// generic DEFAULT_TEMPLATE for null/unknown/personal/other.
const getTemplateFor = (orgCategory) =>
    CATEGORY_TEMPLATES[orgCategory] || DEFAULT_TEMPLATE;

module.exports = {
    ORG_CATEGORY_SLUGS,
    CATEGORY_TEMPLATES,
    DEFAULT_TEMPLATE,
    getTemplateFor,
};
