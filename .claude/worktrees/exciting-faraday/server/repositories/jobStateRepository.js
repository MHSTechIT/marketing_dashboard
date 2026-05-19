// server/repositories/jobStateRepository.js
const { supabase } = require('../supabase');

async function getJobState(jobKey) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    // Note: Table name is 'JobState' (capitalized) in Supabase
    const { data, error } = await supabase
      .from('JobState')
      .select('JobValue')
      .eq('JobKey', jobKey)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[JobStateRepository] Error fetching job state:', error);
      throw error;
    }

    // Column name is capitalized in Supabase: JobValue
    return data?.JobValue ?? null;
  } catch (error) {
    console.error('[JobStateRepository] Error getting job state:', error);
    throw error;
  }
}

async function setJobState(jobKey, jobValue) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    // Note: Table name is 'JobState' (capitalized) with columns: JobKey, JobValue, UpdatedAt
    const { error } = await supabase
      .from('JobState')
      .upsert({
        JobKey: jobKey,
        JobValue: jobValue,
        UpdatedAt: new Date().toISOString()
      }, {
        onConflict: 'JobKey'
      });

    if (error) {
      console.error('[JobStateRepository] Error setting job state:', error);
      throw error;
    }
  } catch (error) {
    console.error('[JobStateRepository] Error setting job state:', error);
    throw error;
  }
}

module.exports = {
  getJobState,
  setJobState,
};
