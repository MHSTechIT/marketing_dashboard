/**
 * Follower Growth Rate utility.
 * Formula: growthRate (%) = (Total New Followers in Period / Current Followers Count) * 100
 *
 * @param {Array<{ date?: string, value?: number }>} dailyFollowersArray - Daily new follower counts (from Meta follower_count insights).
 * @param {number} currentFollowersCount - Current total followers (e.g. from GET /{ig-user-id}?fields=followers_count).
 * @returns {{ totalNewFollowers: number, growthRate: number }}
 */
export function calculateFollowerGrowthRate(dailyFollowersArray, currentFollowersCount) {
  const totalNewFollowers = Array.isArray(dailyFollowersArray)
    ? dailyFollowersArray.reduce((sum, item) => {
        const v = item?.value ?? item?.val;
        const n = typeof v === "number" && !Number.isNaN(v) ? v : Number(v) || 0;
        return sum + (n > 0 ? n : 0);
      }, 0)
    : 0;

  const current = typeof currentFollowersCount === "number" && !Number.isNaN(currentFollowersCount)
    ? currentFollowersCount
    : Number(currentFollowersCount) || 0;

  const growthRate =
    current > 0 && totalNewFollowers >= 0
      ? Math.round((totalNewFollowers / current) * 10000) / 100
      : 0;

  return {
    totalNewFollowers,
    growthRate,
  };
}
