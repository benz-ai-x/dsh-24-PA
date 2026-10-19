# Method - calendar.schedules.cancel

取消（删除）日程，周期日程需指定编辑规则（仅本次、本次及以后、全部）

## Usage

```bash
wecom-cli calendar schedules cancel --json <request_body>
```

## Declarations

```ts
export {
  SchedulesCancelReq as RequestBody,
  SchedulesCancelTypedRsp as Response,
};

/** SchedulesCancel（删除日程） */
interface SchedulesCancelReq {
  /** 周期编辑规则（周期日程必填） */
  repeat_mod?: ScheduleRepeatedMod;
  /**
   * 日程 ID（必填）
   *
   * @minLength 1
   */
  schedule_id: string;
}

interface SchedulesCancelTypedRsp {
}

/** 周期编辑规则（用于更新/删除周期日程） */
interface ScheduleRepeatedMod {
  /** 编辑类型：this_only-仅此场次, this_and_future-此场次及将来, all-所有 */
  repeat_edit_type?: "this_only" | "this_and_future" | "all";
  /** 编辑的目标时间点 */
  repeat_event_time?: string;
}
```
