# Method - todo.finish

机器人视角批量完成待办

## Usage

```bash
wecom-cli todo finish --json <request_body>
```

## Declarations

```ts
export {
  BotTodoChangeUserStatusReq as RequestBody,
  BotTodoChangeUserStatusRsp as Response,
};

interface BotTodoChangeUserStatusReq {
  /**
   * 批量完成待办列表，最多20条
   *
   * @minItems 1
   * @maxItems 20
   */
  items?: BotTodoFinishItem[];
}

interface BotTodoChangeUserStatusRsp {
  /** 批量完成结果列表 */
  items?: BotTodoFinishResultItem[];
  /** 批量完成结果列表 数组元素数量 */
  items_count?: number;
}

/** 单条 finish 入参子消息 */
interface BotTodoFinishItem {
  /** 是否完成所有参与人的份：true=以创建人（机器人）身份整体完成该待办；false 或不传=只完成调用方用户自己那一份。 */
  finished_all?: boolean;
  /** 待办 id */
  todo_id: string;
}

/** 单条 finish 结果子消息 */
interface BotTodoFinishResultItem {
  /** 当没有带 finished_all 时，询问是否要完成整个待办 */
  ask_finish_all?: string;
  /** 错误信息（success=false 时有值） */
  errmsg?: string;
  /** 是否成功 */
  success?: boolean;
  /** 待办标题 */
  title?: string;
  /** 待办 id */
  todo_id?: string;
}
```
