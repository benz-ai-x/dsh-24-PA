# Method - todo.get

批量读取待办详情，返回标题/描述/参与人/时间等

## Usage

```bash
wecom-cli todo get --json <request_body>
```

## Declarations

```ts
export {
  TodoGetDetailReq as RequestBody,
  TodoGetDetailRsp as Response,
};

interface TodoGetDetailReq {
  /**
   * 待办 id 列表，最多20个
   *
   * @minItems 1
   * @maxItems 20
   */
  items?: TodoGetDetailItem[];
}

interface TodoGetDetailRsp {
  /** 待办数据列表，最多20条 */
  items?: TodoGetDetailResultItem[];
  /** 待办数据列表，最多20条 数组元素数量 */
  items_count?: number;
}

/** GetTodoDetail */
interface TodoGetDetailItem {
  /** 待办 id */
  todo_id?: string;
}

interface TodoGetDetailResultItem {
  /** 创建时间，格式：YYYY-MM-DD HH:mm:ss */
  create_time?: string;
  /** 创建人信息对象 */
  creator?: UserInfoRsp;
  /** 截止时间 */
  deadline?: Deadline;
  /** 待办描述 */
  description?: string;
  /** 错误信息（success=false 时有值） */
  errmsg?: string;
  /** 补充信息，例如：将会在 YYYY-MM-DD HH:mm:ss 时间提醒 */
  extra_info?: string;
  /** 参与人列表 */
  followers?: TodoFollowerRsp[];
  /** 待办来源 */
  source?: "single_chat" | "group_chat" | "doc" | "ai_summary" | "meeting_summary" | "face_chat" | "fused_doc" | "smart_sheet" | "smart_doc" | "JSAPI";
  /** 待办状态 */
  status?: "finished" | "proceed" | "deleted";
  /** 是否成功 */
  success?: boolean;
  /** 待办标题 */
  title?: string;
  /** 待办 id */
  todo_id?: string;
  /** 更新时间，格式：YYYY-MM-DD HH:mm:ss */
  update_time?: string;
  /** 用户状态 */
  user_status?: "reject" | "accept" | "finished" | "removed" | "notshow";
}

/** 用户信息 */
interface UserInfoRsp {
  /** 用户 userid对应成员的名称 */
  user_name?: string;
  /** 用户 userid */
  userid?: string;
}

interface Deadline {
  /** 截止时间类型：date=日期，datetime=具体时刻 */
  type?: "date" | "datetime";
  /**
   * 截止时间字符串：date=YYYY-MM-DD，datetime=YYYY-MM-DD HH:mm:ss
   *
   * @minLength 1
   * @maxLength 32
   */
  value?: string;
}

/** 参与人信息 */
interface TodoFollowerRsp {
  /** 更新时间，格式：YYYY-MM-DD HH:mm:ss, todo create 不返回 */
  update_time?: string;
  /** 参与人 userid对应成员的名称 */
  user_name?: string;
  /** 参与人状态, todo create 不返回 */
  user_status?: "reject" | "accept" | "finished" | "removed" | "notshow";
  /** 参与人 userid */
  userid?: string;
}
```
