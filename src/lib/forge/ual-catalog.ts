// Every clip in the Quaternius packs the Oasis ships (public/animations/ual/, CC0: "Free to use in personal,
// educational and commercial projects"), so the animation browser can play any of them on the owner's avatar: the
// two free packs (names read 2026-11-19, the A_TPose left out) and UAL1 Pro, which the owner bought on 24 Nov
// (CC0 as well; Hipster brought it in, fe94e66). Pro holds all of UAL1 Standard but Roll_RM and Sword_Attack_RM;
// only its 77 clips that Standard lacks are listed under it, the rest keep loading from Standard.

import { ANIMATION_LIBRARY, type AnimCategory } from './animation-library'

export const UAL_PACKS: Record<string, string[]> = {
  'ual/UAL1_Standard.glb': [
    'Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Dance_Loop', 'Death01', 'Driving_Loop', 'Fixing_Kneeling', 'Hit_Chest', 'Hit_Head',
    'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop', 'Interact', 'Jog_Fwd_Loop', 'Jump_Land', 'Jump_Loop', 'Jump_Start',
    'PickUp_Table', 'Pistol_Aim_Down', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Idle_Loop', 'Pistol_Reload', 'Pistol_Shoot',
    'Punch_Cross', 'Punch_Jab', 'Push_Loop', 'Roll', 'Roll_RM', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop',
    'Sitting_Talking_Loop', 'Spell_Simple_Enter', 'Spell_Simple_Exit', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Sprint_Loop',
    'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Sword_Attack', 'Sword_Attack_RM', 'Sword_Idle', 'Walk_Formal_Loop', 'Walk_Loop',
  ],
  'ual/UAL1_Pro.glb': [
    'BackFlip', 'Celebration', 'Climb_Down_Loop', 'Climb_Enter', 'Climb_Exit', 'Climb_Idle_Loop', 'Climb_Left_Loop',
    'Climb_Right_Loop', 'Climb_Up_Loop', 'ClimbLedge', 'Counter_Angry', 'Counter_Enter', 'Counter_Exit',
    'Counter_Give', 'Counter_Idle_Loop', 'Counter_Show', 'Crawl_Bwd_Loop', 'Crawl_Enter', 'Crawl_Exit',
    'Crawl_Fwd_Loop', 'Crawl_Idle_Loop', 'Crawl_Left_Loop', 'Crawl_Right_Loop', 'Crouch_Bwd_L_Loop',
    'Crouch_Bwd_Loop', 'Crouch_Bwd_R_Loop', 'Crouch_Enter', 'Crouch_Exit', 'Crouch_Fwd_L_Loop', 'Crouch_Fwd_R_Loop',
    'Crouch_Left_Loop', 'Crouch_Right_Loop', 'Crying', 'Death02', 'Dodge_Left', 'Dodge_Right', 'Drink',
    'GroundSit_Enter', 'GroundSit_Exit', 'GroundSit_Idle_Loop', 'Hit_Shoulder_L', 'Hit_Shoulder_R', 'Hit_Stomach',
    'Idle_LookAround_Loop', 'Idle_Paper', 'Idle_Rock', 'Idle_Scissors', 'Idle_Tired_Loop', 'Jog_Bwd_L_Loop',
    'Jog_Bwd_Loop', 'Jog_Bwd_R_Loop', 'Jog_Fwd_L_Loop', 'Jog_Fwd_LeanL_Loop', 'Jog_Fwd_LeanR_Loop', 'Jog_Fwd_R_Loop',
    'Jog_Left_Loop', 'Jog_Right_Loop', 'Kick', 'PickUp_Kneeling', 'PunchKick_Enter', 'PunchKick_Exit', 'Push_Enter',
    'Push_Exit', 'Sitting_Idle02_Loop', 'Sitting_Idle03_Loop', 'Sitting_Nodding_Loop', 'Spell_Double_Enter',
    'Spell_Double_Exit', 'Spell_Double_Idle_Loop', 'Spell_Double_Shoot_Loop', 'Sprint_Enter', 'Sprint_Exit',
    'Sword_Attack_Standing', 'Sword_Enter', 'Sword_Exit', 'Turn90_L', 'Turn90_R',
  ],
  'ual/UAL2_Standard.glb': [
    'Chest_Open', 'ClimbUp_1m_RM', 'Consume', 'Farm_Harvest', 'Farm_PlantSeed', 'Farm_Watering', 'Hit_Knockback', 'Hit_Knockback_RM',
    'Idle_FoldArms_Loop', 'Idle_Lantern_Loop', 'Idle_No_Loop', 'Idle_Rail_Call', 'Idle_Rail_Loop', 'Idle_Shield_Break', 'Idle_Shield_Loop',
    'Idle_TalkingPhone_Loop', 'LayToIdle', 'Melee_Hook', 'Melee_Hook_Rec', 'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'NinjaJump_Start',
    'OverhandThrow', 'Shield_Dash_RM', 'Shield_OneShot', 'Slide_Exit', 'Slide_Loop', 'Slide_Start', 'Sword_Block', 'Sword_Dash_RM',
    'Sword_Regular_A', 'Sword_Regular_A_Rec', 'Sword_Regular_B', 'Sword_Regular_B_Rec', 'Sword_Regular_C', 'Sword_Regular_Combo',
    'TreeChopping_Loop', 'Walk_Carry_Loop', 'Yes', 'Zombie_Idle_Loop', 'Zombie_Scratch', 'Zombie_Walk_Fwd_Loop',
  ],
}

export interface UalClip { id: string; file: string; clip: string; label: string; group: string }

function groupOf(clip: string): string {
  if (/Walk|Jog|Sprint|Crouch|Crawl|Swim|Slide|Climb|Roll|Jump|Dodge|Turn90|BackFlip/.test(clip)) return 'Moving'
  if (/^Counter_/.test(clip)) return 'Doing things'
  if (/Idle|Sitting|GroundSit|Driving|Lay/.test(clip)) return 'Standing and sitting'
  if (/Sword|Shield|Pistol|Punch|Kick|Melee|Hit|Death|Throw|Spell/.test(clip)) return 'Fighting'
  return 'Doing things'
}

const pretty = (clip: string) => clip.replace(/_RM$/, ' (moves)').replace(/_Loop$/, '').replace(/_/g, ' ')

let cached: UalClip[] | null = null

/** All free clips, each with a library id (an existing one when the Oasis already names that clip). */
export function freeUalClips(): UalClip[] {
  if (cached) return cached
  const out: UalClip[] = []
  for (const [file, clips] of Object.entries(UAL_PACKS)) {
    for (const clip of clips) {
      const known = ANIMATION_LIBRARY.find(a => a.filename === file && a.glbClipName === clip)
      let id = known?.id
      if (!id) {
        id = file.includes('Pro') ? `ualpro-1-${clip}` : `ualfree-${file.includes('UAL2') ? 2 : 1}-${clip}`
        const category: AnimCategory = groupOf(clip) === 'Fighting' ? 'combat' : groupOf(clip) === 'Moving' ? 'locomotion' : 'emote'
        ANIMATION_LIBRARY.push({ id, filename: file, glbClipName: clip, label: pretty(clip), category })
      }
      out.push({ id, file, clip, label: pretty(clip), group: groupOf(clip) })
    }
  }
  cached = out
  return out
}
