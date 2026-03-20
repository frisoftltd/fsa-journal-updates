
<?php
/**
 * FundedControl — Review Controller
 * Handles: get_reviews, save_review
 */
class ReviewController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAll() {
        $s = $this->db->prepare("SELECT * FROM weekly_reviews WHERE user_id=? ORDER BY week_start DESC");
        $s->execute([$this->uid]);
        jsonResponse($s->fetchAll());
    }

    public function save() {
        $d = jsonInput();
        if (!empty($d['id'])) {
            $review_id = validId($d['id']);
            if (!$review_id) jsonError('Invalid review ID');
            $this->db->prepare("UPDATE weekly_reviews SET week_start=?,week_end=?,process_score=?,mindset_score=?,key_lesson=?,what_went_well=?,what_to_improve=?,rules_followed=? WHERE id=? AND user_id=?")
                ->execute([$d['week_start'], $d['week_end'], $d['process_score'], $d['mindset_score'], $d['key_lesson'], $d['what_went_well'], $d['what_to_improve'], $d['rules_followed'], $review_id, $this->uid]);
        } else {
            $this->db->prepare("INSERT INTO weekly_reviews (user_id,week_start,week_end,process_score,mindset_score,key_lesson,what_went_well,what_to_improve,rules_followed) VALUES (?,?,?,?,?,?,?,?,?)")
                ->execute([$this->uid, $d['week_start'], $d['week_end'], $d['process_score'], $d['mindset_score'], $d['key_lesson'], $d['what_went_well'], $d['what_to_improve'], $d['rules_followed']]);
        }
        jsonResponse(['success' => true]);
    }
}
