require('dotenv').config();
const { supabase } = require('./supabase');

function randomInt(min, max) { 
  return Math.floor(Math.random() * (max - min + 1)) + min; 
}

function randomPhone() { 
  return '+1' + (1000000000 + randomInt(0, 899999999)).toString(); 
}

async function run() {
  if (!supabase) {
    console.error('❌ Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  console.log('🌱 Starting seed process...\n');

  try {
    // Clear existing data
    // Table names: 'Leads' and 'Ads' (capitalized) - matches public.Leads and public.Ads
    console.log('Clearing existing data...');
    await supabase.from('Leads').delete().neq('Id', 0); // Delete all leads
    await supabase.from('Ads').delete().neq('Id', 0); // Delete all ads
    console.log('✅ Existing data cleared\n');

    const campaigns = ['Alpha', 'Beta', 'Gamma'];
    const days = 90;
    const now = new Date();

    const adsToInsert = [];
    const leadsToInsert = [];

    // Generate seed data
    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(now);
      date.setDate(now.getDate() - d);
      const dateStr = date.toISOString().slice(0, 10);

      for (const c of campaigns) {
        const leads = Math.max(0, Math.round(3 + Math.random() * 25));
        const spend = Number((Math.random() * 200).toFixed(2));
        const actions = {
          link_click: randomInt(50, 450),
          view_content: randomInt(20, 320),
          add_to_cart: randomInt(0, 40),
          purchase: randomInt(0, 10)
        };

        // Add ad to batch
        // Note: Column names are capitalized: Campaign, DateChar, Leads, Spend, ActionsJson
        adsToInsert.push({
          Campaign: c,
          DateChar: dateStr,
          Leads: leads,
          Spend: spend,
          ActionsJson: actions
        });

        // Generate leads for this ad
        for (let i = 0; i < leads; i++) {
          const name = `Lead ${randomInt(100, 9999)}`;
          const phone = randomPhone();
          const t = new Date(date.getTime() + randomInt(0, 1000 * 60 * 60 * 23));
          
          // Column names: mixed case (Name, Phone, TimeUtc, DateChar, Campaign)
          leadsToInsert.push({
            Name: name,
            Phone: phone,
            TimeUtc: t.toISOString(),
            DateChar: dateStr,
            Campaign: c
          });
        }
      }
    }

    // Insert ads in batches
    console.log(`Inserting ${adsToInsert.length} ads...`);
    const batchSize = 100;
    for (let i = 0; i < adsToInsert.length; i += batchSize) {
      const batch = adsToInsert.slice(i, i + batchSize);
      const { error } = await supabase.from('Ads').insert(batch);
      if (error) {
        console.error(`Error inserting ads batch ${Math.floor(i / batchSize) + 1}:`, error);
        throw error;
      }
    }
    console.log('✅ Ads inserted\n');

    // Insert leads in batches
    console.log(`Inserting ${leadsToInsert.length} leads...`);
    for (let i = 0; i < leadsToInsert.length; i += batchSize) {
      const batch = leadsToInsert.slice(i, i + batchSize);
      const { error } = await supabase.from('Leads').insert(batch);
      if (error) {
        console.error(`Error inserting leads batch ${Math.floor(i / batchSize) + 1}:`, error);
        throw error;
      }
    }
    console.log('✅ Leads inserted\n');

    console.log('✅ Seeding completed successfully!');
    console.log(`   - Ads: ${adsToInsert.length}`);
    console.log(`   - Leads: ${leadsToInsert.length}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

run();
