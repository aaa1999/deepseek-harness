# 学习dsh的架构
# 学习为什么要用cordis 极简模块怎么用
# 这里面的bash是怎么用的
# 会话投影
# cordis的hmr和我在react中的hmr有什么关系？
# dsh的安全边界是怎么做的
# 为什么走 user 消息而不是 system section：系统提示词是“每步原地替换”的（KV Cache 友好），而“用户在此步点名了这个 skill”是一次性会话事实，append 到历史里才可审计、可回放——落盘为带 skill-invocation source 标记的 user/message。