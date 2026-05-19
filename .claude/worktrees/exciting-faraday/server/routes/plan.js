/**
 * Plan page API: teams, weekly targets, and aggregates (Team Performance, Effort & Goals, Ad Spend Forecast).
 * Aggregates call existing Meta (and optional Google Sheets) endpoints internally.
 */
const express = require("express");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const axios = require("axios");
const { supabase } = require("../supabase");
const { optionalAuthMiddleware } = require("../auth");

const router = express.Router();

const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.API_BASE_URL || process.env.PLAN_AGGREGATES_BASE_URL || `http://localhost:${PORT}`;

function toNum(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function weekEnd(weekStart) {
  const d = new Date(weekStart + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// ---------- Teams CRUD ----------
router.get("/teams", optionalAuthMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const { data, error } = await supabase
      .from("plan_teams")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.error("[Plan teams GET]", error);
      return res.status(500).json({ error: error.message });
    }
    res.json({ data: data || [] });
  } catch (err) {
    console.error("[Plan teams GET]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/teams", optionalAuthMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const { name, page_id, ad_account_id, sort_order } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const row = {
      name: name.trim(),
      page_id: page_id != null ? String(page_id).trim() || null : null,
      ad_account_id: ad_account_id != null ? String(ad_account_id).replace(/^act_/, "") || null : null,
      sort_order: typeof sort_order === "number" ? sort_order : 0,
    };
    const { data, error } = await supabase.from("plan_teams").insert(row).select().single();
    if (error) {
      console.error("[Plan teams POST]", error);
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ data });
  } catch (err) {
    console.error("[Plan teams POST]", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/teams/:id", optionalAuthMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid team id" });
    }
    const { name, page_id, ad_account_id, sort_order } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = typeof name === "string" ? name.trim() : "";
    if (page_id !== undefined) updates.page_id = page_id != null ? String(page_id).trim() || null : null;
    if (ad_account_id !== undefined) updates.ad_account_id = ad_account_id != null ? String(ad_account_id).replace(/^act_/, "") || null : null;
    if (sort_order !== undefined) updates.sort_order = typeof sort_order === "number" ? sort_order : 0;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }
    const { data, error } = await supabase.from("plan_teams").update(updates).eq("id", id).select().single();
    if (error) {
      console.error("[Plan teams PUT]", error);
      return res.status(500).json({ error: error.message });
    }
    res.json({ data });
  } catch (err) {
    console.error("[Plan teams PUT]", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/teams/:id", optionalAuthMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid team id" });
    }
    const { error } = await supabase.from("plan_teams").delete().eq("id", id);
    if (error) {
      console.error("[Plan teams DELETE]", error);
      return res.status(500).json({ error: error.message });
    }
    res.status(204).send();
  } catch (err) {
    console.error("[Plan teams DELETE]", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Weekly targets CRUD ----------
router.get("/targets", optionalAuthMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const weekStart = (req.query.week_start || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "week_start (YYYY-MM-DD) is required" });
    }
    const { data: targets, error: targetsError } = await supabase
      .from("plan_weekly_targets")
      .select("*")
      .eq("week_start", weekStart);
    if (targetsError) {
      console.error("[Plan targets GET]", targetsError);
      return res.status(500).json({ error: targetsError.message });
    }
    res.json({ data: targets || [] });
  } catch (err) {
    console.error("[Plan targets GET]", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/targets", optionalAuthMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const { team_id, week_start, target_followers, target_ad_spend, target_organic_leads, target_organic_revenue, target_stories, target_reels, target_posts } = req.body || {};
    const teamId = parseInt(team_id, 10);
    const weekStart = (week_start || "").trim();
    if (!Number.isInteger(teamId) || teamId < 1) {
      return res.status(400).json({ error: "Valid team_id is required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "week_start (YYYY-MM-DD) is required" });
    }
    const row = {
      team_id: teamId,
      week_start: weekStart,
      target_followers: toNum(target_followers),
      target_ad_spend: toNum(target_ad_spend),
      target_organic_leads: toNum(target_organic_leads),
      target_organic_revenue: toNum(target_organic_revenue),
      target_stories: Math.max(0, parseInt(target_stories, 10) || 0),
      target_reels: Math.max(0, parseInt(target_reels, 10) || 0),
      target_posts: Math.max(0, parseInt(target_posts, 10) || 0),
    };
    const { data, error } = await supabase
      .from("plan_weekly_targets")
      .upsert([row], { onConflict: "team_id,week_start" })
      .select()
      .single();
    if (error) {
      console.error("[Plan targets PUT]", error);
      return res.status(500).json({ error: error.message });
    }
    res.json({ data });
  } catch (err) {
    console.error("[Plan targets PUT]", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Aggregates: teams + targets + live achieved from Meta (and optional Sheets) ----------
async function fetchPageInsights(pageId, from, to) {
  try {
    const url = `${BASE_URL}/api/meta/pages/${encodeURIComponent(pageId)}/insights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await axios.get(url, { timeout: 15000, validateStatus: () => true });
    if (res.status !== 200 || !res.data) return { total_follows: 0 };
    const data = res.data.data || res.data;
    return {
      total_follows: toNum(data.total_follows),
      current_followers: toNum(data.current_followers),
    };
  } catch (e) {
    console.warn("[Plan aggregates] Page insights error for page", pageId, e.message);
    return { total_follows: 0, current_followers: 0 };
  }
}

async function fetchActiveCampaigns(adAccountId, from, to) {
  try {
    const id = adAccountId.replace(/^act_/, "");
    const url = `${BASE_URL}/api/meta/active-campaigns?ad_account_id=${encodeURIComponent(id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await axios.get(url, { timeout: 15000, validateStatus: () => true });
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.data)) return { spend: 0, leads: 0 };
    const data = res.data.data;
    const spend = data.reduce((s, c) => s + toNum(c.ad_spend), 0);
    const leads = data.reduce((s, c) => s + toNum(c.leads), 0);
    return { spend, leads };
  } catch (e) {
    console.warn("[Plan aggregates] Active campaigns error for ad account", adAccountId, e.message);
    return { spend: 0, leads: 0 };
  }
}

async function fetchMediaInsights(pageId, from, to) {
  try {
    const url = `${BASE_URL}/api/meta/instagram/media-insights?pageIds=${encodeURIComponent(pageId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await axios.get(url, { timeout: 20000, validateStatus: () => true });
    if (res.status !== 200 || !res.data) return { stories: 0, reels: 0, posts: 0 };
    const by = res.data.byContentType || {};
    return {
      stories: toNum(by.stories && by.stories.count) || 0,
      reels: toNum(by.reels && by.reels.count) || 0,
      posts: toNum(by.posts && by.posts.count) || 0,
    };
  } catch (e) {
    console.warn("[Plan aggregates] Media insights error for page", pageId, e.message);
    return { stories: 0, reels: 0, posts: 0 };
  }
}

// ---------- Daily spend for charts (calls Meta insights/daily-spend) ----------
router.get("/daily-spend", optionalAuthMiddleware, async (req, res) => {
  try {
    const weekStart = (req.query.week_start || "").trim();
    const teamId = req.query.team_id ? parseInt(req.query.team_id, 10) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "week_start (YYYY-MM-DD) is required" });
    }
    const weekEndDate = weekEnd(weekStart);
    let adAccountId = null;
    if (teamId && supabase) {
      const { data: team } = await supabase.from("plan_teams").select("ad_account_id").eq("id", teamId).single();
      if (team && team.ad_account_id) adAccountId = team.ad_account_id;
    }
    const params = new URLSearchParams({ from: weekStart, to: weekEndDate });
    if (adAccountId) params.set("ad_account_id", adAccountId);
    const url = `${BASE_URL}/api/meta/insights/daily-spend?${params.toString()}`;
    const axRes = await axios.get(url, { timeout: 15000, validateStatus: () => true });
    if (axRes.status !== 200 || !axRes.data) {
      return res.json({ data: [] });
    }
    return res.json({ data: axRes.data.data || [] });
  } catch (err) {
    console.warn("[Plan daily-spend]", err.message);
    return res.json({ data: [] });
  }
});

router.get("/aggregates", optionalAuthMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const weekStart = (req.query.week_start || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "week_start (YYYY-MM-DD) is required" });
    }
    const weekEndDate = weekEnd(weekStart);

    const { data: teams, error: teamsError } = await supabase
      .from("plan_teams")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (teamsError) {
      console.error("[Plan aggregates] teams", teamsError);
      return res.status(500).json({ error: teamsError.message });
    }
    if (!teams || teams.length === 0) {
      return res.json({
        data: [],
        budgetForecast: {
          weekly_ad_spend_target: 0,
          actual_ad_spend: 0,
          remaining_budget: 0,
          forecast_ad_spend: 0,
        },
      });
    }

    const { data: targetsRows, error: targetsError } = await supabase
      .from("plan_weekly_targets")
      .select("*")
      .eq("week_start", weekStart);
    if (targetsError) {
      console.error("[Plan aggregates] targets", targetsError);
      return res.status(500).json({ error: targetsError.message });
    }
    const targetsByTeam = {};
    (targetsRows || []).forEach((t) => {
      targetsByTeam[t.team_id] = t;
    });

    const results = [];
    let totalTargetAdSpend = 0;
    let totalActualAdSpend = 0;

    for (const team of teams) {
      const t = targetsByTeam[team.id] || {};
      const target_followers = toNum(t.target_followers);
      const target_ad_spend = toNum(t.target_ad_spend);
      const target_organic_leads = toNum(t.target_organic_leads);
      const target_organic_revenue = toNum(t.target_organic_revenue);
      const target_stories = toNum(t.target_stories);
      const target_reels = toNum(t.target_reels);
      const target_posts = toNum(t.target_posts);

      let achieved_followers = 0;
      let achieved_ad_spend = 0;
      let achieved_organic_leads = 0;
      let achieved_organic_revenue = 0;
      let achieved_stories = 0;
      let achieved_reels = 0;
      let achieved_posts = 0;

      if (team.page_id) {
        const [pageInsights, mediaInsights] = await Promise.all([
          fetchPageInsights(team.page_id, weekStart, weekEndDate),
          fetchMediaInsights(team.page_id, weekStart, weekEndDate),
        ]);
        achieved_followers = pageInsights.total_follows;
        achieved_stories = mediaInsights.stories;
        achieved_reels = mediaInsights.reels;
        achieved_posts = mediaInsights.posts;
      }
      if (team.ad_account_id) {
        const campaigns = await fetchActiveCampaigns(team.ad_account_id, weekStart, weekEndDate);
        achieved_ad_spend = campaigns.spend;
      }

      const remaining_followers = Math.max(0, target_followers - achieved_followers);
      const remaining_ad_spend = Math.max(0, target_ad_spend - achieved_ad_spend);
      const remaining_organic_leads = Math.max(0, target_organic_leads - achieved_organic_leads);
      const remaining_organic_revenue = Math.max(0, target_organic_revenue - achieved_organic_revenue);
      const remaining_stories = Math.max(0, target_stories - achieved_stories);
      const remaining_reels = Math.max(0, target_reels - achieved_reels);
      const remaining_posts = Math.max(0, target_posts - achieved_posts);

      const pct = (achieved, target) => (target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0);

      results.push({
        team: {
          id: team.id,
          name: team.name,
          page_id: team.page_id,
          ad_account_id: team.ad_account_id,
        },
        targets: {
          followers: target_followers,
          ad_spend: target_ad_spend,
          organic_leads: target_organic_leads,
          organic_revenue: target_organic_revenue,
          stories: target_stories,
          reels: target_reels,
          posts: target_posts,
        },
        achieved: {
          followers: achieved_followers,
          ad_spend: achieved_ad_spend,
          organic_leads: achieved_organic_leads,
          organic_revenue: achieved_organic_revenue,
          stories: achieved_stories,
          reels: achieved_reels,
          posts: achieved_posts,
        },
        remaining: {
          followers: remaining_followers,
          ad_spend: remaining_ad_spend,
          organic_leads: remaining_organic_leads,
          organic_revenue: remaining_organic_revenue,
          stories: remaining_stories,
          reels: remaining_reels,
          posts: remaining_posts,
        },
        progressPct: {
          followers: pct(achieved_followers, target_followers),
          ad_spend: pct(achieved_ad_spend, target_ad_spend),
          organic_leads: pct(achieved_organic_leads, target_organic_leads),
          organic_revenue: pct(achieved_organic_revenue, target_organic_revenue),
          stories: pct(achieved_stories, target_stories),
          reels: pct(achieved_reels, target_reels),
          posts: pct(achieved_posts, target_posts),
        },
      });

      totalTargetAdSpend += target_ad_spend;
      totalActualAdSpend += achieved_ad_spend;
    }

    const remainingBudget = Math.max(0, totalTargetAdSpend - totalActualAdSpend);
    const today = new Date().toISOString().slice(0, 10);
    const weekStartDate = new Date(weekStart + "T12:00:00Z").getTime();
    const weekEndTs = new Date(weekEndDate + "T23:59:59Z").getTime();
    const now = Date.now();
    const elapsedDays = weekStartDate <= now && now <= weekEndTs ? (now - weekStartDate) / (24 * 60 * 60 * 1000) : 0;
    const totalDays = 7;
    const remainingDays = Math.max(0, totalDays - elapsedDays);
    let forecastAdSpend = totalActualAdSpend;
    if (elapsedDays > 0 && totalDays > elapsedDays) {
      const dailyRate = totalActualAdSpend / elapsedDays;
      forecastAdSpend = totalActualAdSpend + dailyRate * remainingDays;
    }

    res.json({
      data: results,
      budgetForecast: {
        weekly_ad_spend_target: totalTargetAdSpend,
        actual_ad_spend: totalActualAdSpend,
        remaining_budget: remainingBudget,
        forecast_ad_spend: Math.round(forecastAdSpend * 100) / 100,
      },
    });
  } catch (err) {
    console.error("[Plan aggregates]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
